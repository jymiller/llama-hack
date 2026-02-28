"""
Timesheet Reconciliation Crew - Orchestrates extraction and validation agents.

This module provides the main entry point for running the CrewAI pipeline:
1. Extraction Agent processes OCR text from documents
2. Validation Agent validates and reconciles the extracted data
"""

import os
from crewai import Crew, Process
from typing import Optional
import snowflake.connector

from agents import (
    create_extraction_agent,
    create_extraction_task,
    create_validation_agent,
    create_validation_task,
    create_reconciliation_task,
    create_ground_truth_agent,
    create_ground_truth_task,
)


class TimesheetReconciliationCrew:
    """
    Orchestrates the timesheet extraction and reconciliation workflow.
    
    Usage:
        crew = TimesheetReconciliationCrew(snowflake_conn)
        results = crew.run(doc_ids=["doc1", "doc2"], hourly_rate=150.0)
    """
    
    def __init__(
        self,
        snowflake_connection: Optional[snowflake.connector.SnowflakeConnection] = None,
        llm=None,
    ):
        """
        Initialize the crew with optional Snowflake connection and LLM.
        
        Args:
            snowflake_connection: Active Snowflake connection for data operations
            llm: Optional LLM instance (defaults to CrewAI default)
        """
        self.conn = snowflake_connection
        self.llm = llm
        
        # Create agents
        self.extraction_agent = create_extraction_agent(llm=llm)
        self.validation_agent = create_validation_agent(llm=llm)
        self.ground_truth_agent = create_ground_truth_agent(llm=llm)
    
    def get_ocr_text(self, doc_id: str) -> tuple[str, str]:
        """
        Retrieve OCR text from Snowflake for a document.
        
        Args:
            doc_id: Document identifier
            
        Returns:
            Tuple of (ocr_text, doc_type)
        """
        if not self.conn:
            raise ValueError("Snowflake connection required for OCR retrieval")
        
        cursor = self.conn.cursor()
        try:
            # Assumes RAW_DOCUMENTS table with OCR text stored
            cursor.execute("""
                SELECT doc_type, ocr_text
                FROM RAW_DOCUMENTS
                WHERE doc_id = %s
            """, (doc_id,))
            row = cursor.fetchone()
            if not row:
                raise ValueError(f"Document {doc_id} not found")
            return row[1], row[0]
        finally:
            cursor.close()
    
    def save_extracted_lines(self, doc_id: str, extraction_result: dict) -> None:
        """Save extracted lines to Snowflake EXTRACTED_LINES table."""
        if not self.conn:
            return
        
        cursor = self.conn.cursor()
        try:
            # Cascade-delete existing data so re-runs are idempotent
            cursor.execute("DELETE FROM LEDGER_APPROVALS WHERE doc_id = %s", (doc_id,))
            cursor.execute("DELETE FROM VALIDATION_RESULTS WHERE doc_id = %s", (doc_id,))
            cursor.execute("DELETE FROM EXTRACTED_LINES WHERE doc_id = %s", (doc_id,))
            for i, line in enumerate(extraction_result.get("lines", [])):
                cursor.execute("""
                    INSERT INTO EXTRACTED_LINES
                    (line_id, doc_id, worker, work_date, project, hours,
                     extraction_confidence, raw_text_snippet)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    f"{doc_id}_L{i+1}",
                    doc_id,
                    line.get("worker"),
                    line.get("work_date"),
                    line.get("project"),
                    line.get("hours"),
                    line.get("extraction_confidence"),
                    line.get("raw_text_snippet"),
                ))
            self.conn.commit()
        finally:
            cursor.close()
    
    def save_validation_results(self, validation_result: dict) -> None:
        """Save validation results to Snowflake VALIDATION_RESULTS table."""
        if not self.conn:
            return
        
        cursor = self.conn.cursor()
        try:
            # Clear existing results so re-runs are idempotent
            cursor.execute(
                "DELETE FROM VALIDATION_RESULTS WHERE doc_id = %s",
                (validation_result["doc_id"],),
            )
            for i, check in enumerate(validation_result.get("checks", [])):
                cursor.execute("""
                    INSERT INTO VALIDATION_RESULTS
                    (validation_id, doc_id, line_id, rule_name, status, details, computed_value)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    f"{validation_result['doc_id']}_V{i+1}",
                    validation_result["doc_id"],
                    check.get("line_id"),
                    check["rule_name"],
                    check["status"],
                    check["details"],
                    check.get("computed_value"),
                ))
            self.conn.commit()
        finally:
            cursor.close()
    
    def save_reconciliation(self, recon_result: dict) -> None:
        """Save reconciliation summary to Snowflake RECON_SUMMARY table."""
        if not self.conn:
            return
        
        cursor = self.conn.cursor()
        try:
            cursor.execute("""
                INSERT INTO RECON_SUMMARY
                (period_month, period_quarter, approved_hours, implied_cost,
                 invoice_subsub_amount, invoice_my_amount, variance_subsub, variance_my)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                recon_result["period_month"],
                recon_result["period_quarter"],
                recon_result["approved_hours"],
                recon_result["implied_cost"],
                recon_result.get("invoice_subsub_amount"),
                recon_result.get("invoice_my_amount"),
                recon_result.get("variance_subsub"),
                recon_result.get("variance_my"),
            ))
            self.conn.commit()
        finally:
            cursor.close()
    
    def get_ground_truth(self, doc_id: str) -> list[dict]:
        """
        Retrieve ground truth lines from Snowflake for a document.
        
        Args:
            doc_id: Document identifier
            
        Returns:
            List of ground truth line dicts
        """
        if not self.conn:
            return []
        
        cursor = self.conn.cursor()
        try:
            cursor.execute("""
                SELECT worker, work_date, project, hours, notes
                FROM GROUND_TRUTH_LINES
                WHERE doc_id = %s
                ORDER BY work_date, project
            """, (doc_id,))
            rows = cursor.fetchall()
            return [
                {
                    "worker": row[0],
                    "work_date": str(row[1]),
                    "project": row[2],
                    "hours": float(row[3]) if row[3] else 0,
                    "notes": row[4],
                }
                for row in rows
            ]
        finally:
            cursor.close()
    
    def run_ground_truth_comparison(
        self, extraction_result: dict, ground_truth_lines: list[dict], doc_id: str
    ) -> dict:
        """
        Run ground truth comparison on extracted data.
        
        Args:
            extraction_result: Output from extraction
            ground_truth_lines: Analyst-entered ground truth
            doc_id: Document identifier
            
        Returns:
            Accuracy report as dictionary
        """
        task = create_ground_truth_task(
            self.ground_truth_agent, extraction_result, ground_truth_lines, doc_id
        )
        
        crew = Crew(
            agents=[self.ground_truth_agent],
            tasks=[task],
            process=Process.sequential,
            verbose=True,
        )
        
        result = crew.kickoff()
        return result.pydantic.model_dump() if hasattr(result, "pydantic") else result
    
    def run_extraction(self, ocr_text: str, doc_id: str, doc_type: str) -> dict:
        """
        Run extraction on a single document.
        
        Args:
            ocr_text: Raw OCR text
            doc_id: Document identifier
            doc_type: Document type (TIMESHEET, SUBSUB_INVOICE, MY_INVOICE)
            
        Returns:
            Extraction result as dictionary
        """
        task = create_extraction_task(
            self.extraction_agent, ocr_text, doc_id, doc_type
        )
        
        crew = Crew(
            agents=[self.extraction_agent],
            tasks=[task],
            process=Process.sequential,
            verbose=True,
        )
        
        result = crew.kickoff()
        return result.pydantic.model_dump() if hasattr(result, "pydantic") else result
    
    def run_validation(self, extraction_result: dict, doc_id: str) -> dict:
        """
        Run validation on extracted data.
        
        Args:
            extraction_result: Output from extraction
            doc_id: Document identifier
            
        Returns:
            Validation result as dictionary
        """
        task = create_validation_task(
            self.validation_agent, extraction_result, doc_id
        )
        
        crew = Crew(
            agents=[self.validation_agent],
            tasks=[task],
            process=Process.sequential,
            verbose=True,
        )
        
        result = crew.kickoff()
        return result.pydantic.model_dump() if hasattr(result, "pydantic") else result
    
    def run_reconciliation(
        self,
        validated_timesheets: list[dict],
        subsub_invoice: Optional[dict],
        my_invoice: Optional[dict],
        hourly_rate: float,
        tolerance_pct: float = 1.0,
    ) -> dict:
        """
        Run reconciliation across all validated documents.
        
        Args:
            validated_timesheets: List of validated timesheet extractions
            subsub_invoice: Sub-sub contractor invoice (optional)
            my_invoice: Subcontractor invoice to prime (optional)
            hourly_rate: Hourly rate for calculations
            tolerance_pct: Variance tolerance percentage
            
        Returns:
            Reconciliation result as dictionary
        """
        task = create_reconciliation_task(
            self.validation_agent,
            validated_timesheets,
            subsub_invoice,
            my_invoice,
            hourly_rate,
            tolerance_pct,
        )
        
        crew = Crew(
            agents=[self.validation_agent],
            tasks=[task],
            process=Process.sequential,
            verbose=True,
        )
        
        result = crew.kickoff()
        return result.pydantic.model_dump() if hasattr(result, "pydantic") else result
    
    def run(
        self,
        doc_ids: list[str],
        hourly_rate: float = 150.0,
        tolerance_pct: float = 1.0,
        save_to_snowflake: bool = True,
    ) -> dict:
        """
        Run the full extraction, validation, and reconciliation pipeline.
        
        Args:
            doc_ids: List of document IDs to process
            hourly_rate: Hourly rate for cost calculations
            tolerance_pct: Variance tolerance percentage
            save_to_snowflake: Whether to persist results to Snowflake
            
        Returns:
            Complete pipeline results
        """
        extractions = []
        validations = []
        timesheets = []
        subsub_invoice = None
        my_invoice = None
        
        # Phase 1: Extract all documents
        for doc_id in doc_ids:
            ocr_text, doc_type = self.get_ocr_text(doc_id)
            extraction = self.run_extraction(ocr_text, doc_id, doc_type)
            extractions.append(extraction)
            
            if save_to_snowflake:
                self.save_extracted_lines(doc_id, extraction)
            
            # Categorize by type
            if doc_type == "TIMESHEET":
                timesheets.append(extraction)
            elif doc_type == "SUBSUB_INVOICE":
                subsub_invoice = extraction
            elif doc_type == "MY_INVOICE":
                my_invoice = extraction
        
        # Phase 2: Validate all documents
        for extraction in extractions:
            validation = self.run_validation(extraction, extraction["doc_id"])
            validations.append(validation)
            
            if save_to_snowflake:
                self.save_validation_results(validation)
        
        # Phase 3: Ground Truth Comparison (if ground truth data exists)
        accuracy_reports = []
        for extraction in extractions:
            doc_id = extraction["doc_id"]
            gt_lines = self.get_ground_truth(doc_id)
            if gt_lines:
                report = self.run_ground_truth_comparison(extraction, gt_lines, doc_id)
                accuracy_reports.append(report)
        
        # Phase 4: Reconcile (uses trusted ledger if approvals exist, else extracted)
        reconciliation = self.run_reconciliation(
            timesheets, subsub_invoice, my_invoice, hourly_rate, tolerance_pct
        )
        
        if save_to_snowflake:
            self.save_reconciliation(reconciliation)
        
        return {
            "extractions": extractions,
            "validations": validations,
            "accuracy_reports": accuracy_reports,
            "reconciliation": reconciliation,
        }


def create_snowflake_connection() -> snowflake.connector.SnowflakeConnection:
    """
    Create a Snowflake connection from environment variables.
    
    Required env vars:
        SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, SNOWFLAKE_PASSWORD,
        SNOWFLAKE_DATABASE, SNOWFLAKE_SCHEMA, SNOWFLAKE_WAREHOUSE
    """
    return snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.environ["SNOWFLAKE_USER"],
        password=os.environ["SNOWFLAKE_PASSWORD"],
        database=os.environ.get("SNOWFLAKE_DATABASE", "RECONCILIATION"),
        schema=os.environ.get("SNOWFLAKE_SCHEMA", "PUBLIC"),
        warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "COMPUTE_WH"),
    )


if __name__ == "__main__":
    # Example usage
    from dotenv import load_dotenv
    load_dotenv()
    
    conn = create_snowflake_connection()
    crew = TimesheetReconciliationCrew(snowflake_connection=conn)
    
    # Process documents
    results = crew.run(
        doc_ids=["TS_2024_01", "TS_2024_02", "INV_SUBSUB_01", "INV_MY_01"],
        hourly_rate=150.0,
        tolerance_pct=1.0,
    )
    
    print("Pipeline completed!")
    print(f"Extractions: {len(results['extractions'])}")
    print(f"Validations: {len(results['validations'])}")
    print(f"Reconciliation within tolerance: {results['reconciliation']['within_tolerance']}")
