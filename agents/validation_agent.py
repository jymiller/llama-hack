"""
Validation/Reconciliation Agent - Validates extracted data and performs reconciliation.

This agent performs:
- Document-level validation (worker identifiable, reporting period, totals, confidence)
- Line-level validation (date format, numeric hours, hours range, required fields)
- Cross-artifact validation (Approved Hours × Rate ≈ Invoice Amount)
- Reconciliation calculations with variance detection
"""

from crewai import Agent, Task
from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum


class ValidationStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    WARN = "WARN"


class ValidationCheck(BaseModel):
    """Single validation check result."""
    rule_name: str = Field(description="Name of the validation rule")
    status: ValidationStatus = Field(description="PASS, FAIL, or WARN")
    details: str = Field(description="Explanation of the result")
    computed_value: Optional[str] = Field(default=None, description="Supporting data")
    line_id: Optional[str] = Field(default=None, description="Line reference if line-level")


class ValidationResult(BaseModel):
    """Complete validation result for a document."""
    doc_id: str = Field(description="Document identifier")
    overall_status: ValidationStatus = Field(description="Overall validation status")
    checks: list[ValidationCheck] = Field(default_factory=list)
    valid_line_count: int = Field(default=0)
    invalid_line_count: int = Field(default=0)
    warnings_count: int = Field(default=0)


class ReconciliationResult(BaseModel):
    """Reconciliation summary for a period."""
    period_month: str = Field(description="Month in YYYY-MM format")
    period_quarter: str = Field(description="Quarter in YYYY-QN format")
    approved_hours: float = Field(description="Total approved hours")
    hourly_rate: float = Field(description="Assumed or extracted hourly rate")
    implied_cost: float = Field(description="approved_hours × hourly_rate")
    invoice_subsub_amount: Optional[float] = Field(default=None)
    invoice_my_amount: Optional[float] = Field(default=None)
    variance_subsub: Optional[float] = Field(default=None)
    variance_subsub_pct: Optional[float] = Field(default=None)
    variance_my: Optional[float] = Field(default=None)
    variance_my_pct: Optional[float] = Field(default=None)
    variance_tolerance_pct: float = Field(default=1.0, description="Tolerance threshold")
    within_tolerance: bool = Field(description="True if all variances within tolerance")
    exception_details: Optional[str] = Field(default=None)


def create_validation_agent(llm=None) -> Agent:
    """
    Create the Validation/Reconciliation Agent.
    
    Args:
        llm: Optional LLM instance. If None, uses CrewAI default.
    
    Returns:
        Configured CrewAI Agent for validation and reconciliation tasks.
    """
    return Agent(
        role="Financial Validation & Reconciliation Specialist",
        goal="Validate timesheet data integrity and reconcile against invoices with zero tolerance for errors",
        backstory="""You are a meticulous financial auditor specializing in contractor 
        timesheet reconciliation. You apply systematic validation rules at document, line, 
        and cross-artifact levels. You understand that even small discrepancies can indicate 
        billing errors or fraud. You are thorough in checking date formats, hour ranges, 
        required fields, and mathematical accuracy. When reconciling invoices against 
        approved time, you calculate variances and flag any that exceed tolerance thresholds.""",
        verbose=True,
        allow_delegation=False,
        llm=llm,
    )


def create_validation_task(agent: Agent, extraction_result: dict, doc_id: str) -> Task:
    """
    Create a task for validating extracted data.
    
    Args:
        agent: The validation agent
        extraction_result: Output from the extraction agent (as dict)
        doc_id: Document identifier
    
    Returns:
        Configured CrewAI Task for validation
    """
    return Task(
        description=f"""
        Validate the extracted data for document {doc_id}.
        
        Extracted Data:
        ---
        {extraction_result}
        ---
        
        Apply these validation checks:
        
        DOCUMENT-LEVEL:
        1. Worker identifiable - at least one worker name/id is present
        2. Reporting period present - dates are extractable
        3. Totals detected - if a total is shown, verify it
        4. Extraction confidence - flag if average confidence < 0.7
        
        LINE-LEVEL (for each line):
        1. Valid date format - must be parseable as YYYY-MM-DD
        2. Numeric hours - must be a valid number
        3. Hours in range - must be between 0 and 24
        4. Required fields present - worker, date, hours must exist
        
        For each check, record:
        - rule_name: Name of the rule
        - status: PASS, FAIL, or WARN
        - details: Explanation
        - computed_value: Any relevant calculated value
        - line_id: If this is a line-level check
        
        Determine the overall_status:
        - FAIL if any check fails
        - WARN if no failures but warnings exist
        - PASS if all checks pass
        """,
        expected_output="""
        A validation result containing:
        - doc_id: Document identifier
        - overall_status: PASS, FAIL, or WARN
        - checks: List of all validation checks performed
        - valid_line_count: Number of lines that passed all checks
        - invalid_line_count: Number of lines with failures
        - warnings_count: Number of warnings
        """,
        agent=agent,
        output_pydantic=ValidationResult,
    )


def create_reconciliation_task(
    agent: Agent,
    validated_timesheets: list[dict],
    subsub_invoice: Optional[dict],
    my_invoice: Optional[dict],
    hourly_rate: float,
    tolerance_pct: float = 1.0,
) -> Task:
    """
    Create a task for reconciling timesheets against invoices.
    
    Args:
        agent: The validation agent
        validated_timesheets: List of validated timesheet extractions
        subsub_invoice: Sub-sub contractor invoice data (optional)
        my_invoice: Subcontractor invoice data (optional)
        hourly_rate: Hourly rate for cost calculation
        tolerance_pct: Variance tolerance percentage (default 1%)
    
    Returns:
        Configured CrewAI Task for reconciliation
    """
    return Task(
        description=f"""
        Reconcile approved timesheet hours against invoices.
        
        Validated Timesheets:
        ---
        {validated_timesheets}
        ---
        
        Sub-Sub Contractor Invoice:
        ---
        {subsub_invoice if subsub_invoice else "Not provided"}
        ---
        
        My Invoice (to Prime):
        ---
        {my_invoice if my_invoice else "Not provided"}
        ---
        
        Hourly Rate: ${hourly_rate}/hour
        Variance Tolerance: ±{tolerance_pct}%
        
        Perform reconciliation:
        
        1. Calculate total approved hours from validated timesheets
        2. Calculate implied cost: approved_hours × hourly_rate
        3. If sub-sub invoice provided:
           - Extract invoice amount
           - Calculate variance: invoice_amount - implied_cost
           - Calculate variance percentage
        4. If my invoice provided:
           - Extract invoice amount  
           - Calculate variance
           - Calculate variance percentage
        5. Determine if variances are within tolerance
        6. If any variance exceeds tolerance, provide exception_details
        
        Group results by month and quarter based on work dates.
        """,
        expected_output="""
        A reconciliation result containing:
        - period_month and period_quarter
        - approved_hours and implied_cost
        - invoice amounts and variances
        - within_tolerance flag
        - exception_details if variances exceed tolerance
        """,
        agent=agent,
        output_pydantic=ReconciliationResult,
    )
