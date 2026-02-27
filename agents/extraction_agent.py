"""
Extraction Agent - Converts OCR text from Snowflake Cortex into structured timesheet/invoice rows.

This agent takes raw OCR output and extracts:
- Worker name/id
- Work date
- Project identifier
- Hours worked
- Document type (TIMESHEET, SUBSUB_INVOICE, MY_INVOICE)
- Extraction confidence score
"""

from crewai import Agent, Task
from pydantic import BaseModel, Field
from typing import Optional
from datetime import date


class ExtractedLine(BaseModel):
    """Structured representation of an extracted timesheet or invoice line."""
    worker: str = Field(description="Worker name or identifier")
    work_date: str = Field(description="Date of work in YYYY-MM-DD format")
    project: str = Field(description="Project identifier or name")
    hours: float = Field(description="Number of hours worked")
    document_type: str = Field(description="Type: TIMESHEET, SUBSUB_INVOICE, or MY_INVOICE")
    extraction_confidence: float = Field(description="Confidence score 0-1")
    raw_text_snippet: str = Field(description="Original text snippet for audit trail")


class ExtractionResult(BaseModel):
    """Result of extraction from a single document."""
    doc_id: str = Field(description="Document identifier")
    lines: list[ExtractedLine] = Field(default_factory=list)
    total_hours: Optional[float] = Field(default=None, description="Total hours if detected")
    period_start: Optional[str] = Field(default=None, description="Reporting period start")
    period_end: Optional[str] = Field(default=None, description="Reporting period end")
    extraction_notes: str = Field(default="", description="Any notes about the extraction")


def create_extraction_agent(llm=None) -> Agent:
    """
    Create the Extraction Agent for parsing OCR output.
    
    Args:
        llm: Optional LLM instance. If None, uses CrewAI default.
    
    Returns:
        Configured CrewAI Agent for extraction tasks.
    """
    return Agent(
        role="Document Extraction Specialist",
        goal="Extract structured timesheet and invoice data from OCR text with high accuracy",
        backstory="""You are an expert at parsing unstructured OCR output from timesheet 
        screenshots and invoice images. You understand common timesheet formats, can identify 
        worker names, dates, projects, and hours even when the OCR output is imperfect. 
        You are meticulous about preserving the original text for audit purposes and 
        assigning confidence scores based on OCR quality.""",
        verbose=True,
        allow_delegation=False,
        llm=llm,
    )


def create_extraction_task(agent: Agent, ocr_text: str, doc_id: str, doc_type: str) -> Task:
    """
    Create a task for extracting data from OCR text.
    
    Args:
        agent: The extraction agent
        ocr_text: Raw OCR text from Snowflake Cortex PARSE_DOCUMENT
        doc_id: Document identifier
        doc_type: Type of document (TIMESHEET, SUBSUB_INVOICE, MY_INVOICE)
    
    Returns:
        Configured CrewAI Task
    """
    return Task(
        description=f"""
        Extract structured data from the following OCR text of a {doc_type}.
        
        Document ID: {doc_id}
        Document Type: {doc_type}
        
        OCR Text:
        ---
        {ocr_text}
        ---
        
        Your task:
        1. Identify all line items (worker entries, invoice line items)
        2. For each line, extract:
           - worker: The worker's name or ID
           - work_date: Date in YYYY-MM-DD format
           - project: Project name or code
           - hours: Number of hours (as a decimal)
        3. Assign a confidence score (0-1) based on OCR clarity
        4. Preserve the original text snippet for audit
        5. If you detect totals or reporting periods, include them
        
        Handle OCR imperfections gracefully. If a field is unclear, make your best guess
        and reflect that in the confidence score.
        """,
        expected_output="""
        A structured extraction result containing:
        - doc_id: The document identifier
        - lines: List of extracted line items with worker, date, project, hours, confidence
        - total_hours: Detected total if present
        - period_start/period_end: Reporting period if detected
        - extraction_notes: Any observations about the extraction quality
        """,
        agent=agent,
        output_pydantic=ExtractionResult,
    )
