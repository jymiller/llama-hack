"""
Ground Truth Agent - Compares extracted data against analyst-entered ground truth.

This agent performs:
- Comparison of extracted lines against financial analyst ground truth entries
- Accuracy measurement (matched, missing, extra, discrepancy counts)
- Hours delta analysis per document and overall
"""

from crewai import Agent, Task
from pydantic import BaseModel, Field
from typing import Optional


class GroundTruthLine(BaseModel):
    """A single ground truth entry from the financial analyst."""
    worker: str = Field(description="Worker name")
    work_date: str = Field(description="Date in YYYY-MM-DD format")
    project: str = Field(description="Project identifier")
    hours: float = Field(description="Correct hours worked")
    notes: Optional[str] = Field(default=None, description="Analyst notes")


class LineComparison(BaseModel):
    """Comparison between an extracted line and ground truth."""
    work_date: str = Field(description="Date being compared")
    project: str = Field(description="Project being compared")
    gt_hours: Optional[float] = Field(default=None, description="Ground truth hours")
    ext_hours: Optional[float] = Field(default=None, description="Extracted hours")
    hours_delta: float = Field(default=0.0, description="Absolute difference in hours")
    status: str = Field(description="MATCH, DISCREPANCY, MISSING_EXTRACTED, EXTRA_EXTRACTED")
    details: str = Field(default="", description="Explanation of comparison result")


class AccuracyReport(BaseModel):
    """Accuracy report comparing extraction against ground truth for a document."""
    doc_id: str = Field(description="Document identifier")
    total_gt_lines: int = Field(description="Number of ground truth entries")
    total_ext_lines: int = Field(description="Number of extracted entries")
    matched: int = Field(default=0, description="Lines matching exactly")
    discrepancies: int = Field(default=0, description="Lines with hour/date mismatches")
    missing_extracted: int = Field(default=0, description="GT lines not found in extraction")
    extra_extracted: int = Field(default=0, description="Extracted lines not in GT")
    total_gt_hours: float = Field(description="Total ground truth hours")
    total_ext_hours: float = Field(description="Total extracted hours")
    hours_accuracy_pct: float = Field(description="Percentage accuracy of total hours")
    line_comparisons: list[LineComparison] = Field(default_factory=list)
    summary: str = Field(description="Overall accuracy summary")


def create_ground_truth_agent(llm=None) -> Agent:
    """
    Create the Ground Truth Comparison Agent.

    Args:
        llm: Optional LLM instance. If None, uses CrewAI default.

    Returns:
        Configured CrewAI Agent for ground truth comparison.
    """
    return Agent(
        role="Financial Accuracy Analyst",
        goal="Compare AI-extracted timesheet data against analyst-verified ground truth to measure extraction accuracy",
        backstory="""You are a financial analyst who specializes in data quality assurance.
        You meticulously compare machine-extracted data against human-verified ground truth
        to identify discrepancies, measure accuracy, and ensure the extraction pipeline
        produces reliable results. You understand that even small hour differences matter
        in financial reconciliation and you flag every mismatch clearly.""",
        verbose=True,
        allow_delegation=False,
        llm=llm,
    )


def create_ground_truth_task(
    agent: Agent,
    extraction_result: dict,
    ground_truth_lines: list[dict],
    doc_id: str,
) -> Task:
    """
    Create a task for comparing extracted data against ground truth.

    Args:
        agent: The ground truth agent
        extraction_result: Output from the extraction agent (as dict)
        ground_truth_lines: List of analyst-entered ground truth entries
        doc_id: Document identifier

    Returns:
        Configured CrewAI Task for ground truth comparison
    """
    return Task(
        description=f"""
        Compare the AI-extracted timesheet data against the financial analyst's
        ground truth entries for document {doc_id}.

        Extracted Data:
        ---
        {extraction_result}
        ---

        Ground Truth (analyst-verified):
        ---
        {ground_truth_lines}
        ---

        Perform the following comparison:

        1. Match extracted lines to ground truth lines by work_date and project
        2. For each matched pair:
           - Compare hours (exact match if delta < 0.01)
           - Flag as MATCH or DISCREPANCY
           - Calculate hours_delta
        3. Identify MISSING_EXTRACTED: GT lines with no matching extraction
        4. Identify EXTRA_EXTRACTED: Extracted lines with no matching GT
        5. Calculate overall metrics:
           - Total GT hours vs total extracted hours
           - Percentage accuracy: (1 - abs(ext_hours - gt_hours) / gt_hours) * 100
           - Counts of matched, discrepancy, missing, extra
        6. Provide a summary assessment of extraction quality
        """,
        expected_output="""
        An accuracy report containing:
        - doc_id
        - Counts: total_gt_lines, total_ext_lines, matched, discrepancies,
          missing_extracted, extra_extracted
        - Hours: total_gt_hours, total_ext_hours, hours_accuracy_pct
        - line_comparisons: detailed per-line comparison results
        - summary: overall assessment
        """,
        agent=agent,
        output_pydantic=AccuracyReport,
    )
