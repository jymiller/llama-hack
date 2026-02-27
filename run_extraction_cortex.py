"""
Run extraction using Snowflake Cortex AI_COMPLETE directly.
This bypasses CrewAI's LLM requirements and uses Cortex natively.
"""
import json
import snowflake.connector
import os
from dotenv import load_dotenv

load_dotenv()

# Extraction prompt template
EXTRACTION_PROMPT = """You are a document extraction specialist. Extract structured timesheet data from the following OCR text.

Document ID: {doc_id}
Document Type: TIMESHEET

OCR Text:
---
{ocr_text}
---

Extract ALL time entries as a JSON array. For each entry, provide:
- worker: Worker name (e.g., "Mike Agrawal")
- work_date: Date in YYYY-MM-DD format
- project: Project name or code
- hours: Number of hours as decimal
- extraction_confidence: 0-1 score based on OCR clarity
- raw_text_snippet: Original text snippet for audit

Also include:
- total_hours: Total hours if visible
- period_start: Start date of period (YYYY-MM-DD)
- period_end: End date of period (YYYY-MM-DD)

Return ONLY valid JSON in this exact format:
{{
  "doc_id": "{doc_id}",
  "lines": [
    {{
      "worker": "Name",
      "work_date": "YYYY-MM-DD",
      "project": "Project Name",
      "hours": 8.0,
      "extraction_confidence": 0.9,
      "raw_text_snippet": "original text"
    }}
  ],
  "total_hours": 40.0,
  "period_start": "YYYY-MM-DD",
  "period_end": "YYYY-MM-DD",
  "extraction_notes": "Any notes about extraction quality"
}}"""


def get_connection():
    """Get Snowflake connection."""
    return snowflake.connector.connect(
        account=os.environ["SNOWFLAKE_ACCOUNT"],
        user=os.environ["SNOWFLAKE_USER"],
        password=os.environ["SNOWFLAKE_PASSWORD"],
        database="RECONCILIATION",
        schema="PUBLIC",
        warehouse="DEFAULT_WH",
    )


def extract_with_cortex(conn, doc_id: str, ocr_text: str) -> dict:
    """
    Use Snowflake Cortex AI_COMPLETE to extract structured data from OCR text.
    """
    prompt = EXTRACTION_PROMPT.format(doc_id=doc_id, ocr_text=ocr_text)
    
    # Escape for SQL
    escaped_prompt = prompt.replace("'", "''")
    
    cursor = conn.cursor()
    try:
        sql = f"""
            SELECT SNOWFLAKE.CORTEX.COMPLETE(
                'llama3.1-70b',
                '{escaped_prompt}'
            ) AS response
        """
        cursor.execute(sql)
        result = cursor.fetchone()
        response_text = result[0] if result else "{}"
        
        # Parse JSON from response
        # Find JSON in response (it might have extra text)
        try:
            # Try to find JSON object in response
            start = response_text.find('{')
            end = response_text.rfind('}') + 1
            if start >= 0 and end > start:
                json_str = response_text[start:end]
                return json.loads(json_str)
        except json.JSONDecodeError:
            pass
        
        return {"doc_id": doc_id, "raw_response": response_text, "lines": [], "error": "Failed to parse JSON"}
        
    finally:
        cursor.close()


def save_extracted_lines(conn, doc_id: str, extraction: dict):
    """Save extracted lines to EXTRACTED_LINES table."""
    cursor = conn.cursor()
    try:
        for i, line in enumerate(extraction.get("lines", [])):
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
        conn.commit()
        print(f"  Saved {len(extraction.get('lines', []))} lines to EXTRACTED_LINES")
    except Exception as e:
        print(f"  Error saving lines: {e}")
        conn.rollback()
    finally:
        cursor.close()


def main():
    print("=" * 60)
    print("Extracting timesheets using Snowflake Cortex")
    print("=" * 60)
    
    conn = get_connection()
    
    # Fetch documents from RAW_DOCUMENTS
    cursor = conn.cursor()
    cursor.execute("SELECT doc_id, doc_type, ocr_text FROM RAW_DOCUMENTS ORDER BY doc_id")
    documents = cursor.fetchall()
    cursor.close()
    
    all_results = {}
    
    for doc_id, doc_type, ocr_text in documents:
        print(f"\n>>> Processing {doc_id}...")
        
        try:
            result = extract_with_cortex(conn, doc_id, ocr_text)
            all_results[doc_id] = result
            
            lines_count = len(result.get("lines", []))
            total_hours = result.get("total_hours", "N/A")
            print(f"<<< Extracted {lines_count} lines, Total hours: {total_hours}")
            
            # Save to Snowflake
            if lines_count > 0:
                save_extracted_lines(conn, doc_id, result)
                
        except Exception as e:
            print(f"<<< ERROR: {e}")
            all_results[doc_id] = {"doc_id": doc_id, "error": str(e), "lines": []}
    
    # Save results to JSON file
    with open("extraction_results.json", "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    
    print("\n" + "=" * 60)
    print("Extraction complete!")
    print("=" * 60)
    
    # Summary
    total_lines = sum(len(r.get("lines", [])) for r in all_results.values())
    total_hours = sum(r.get("total_hours", 0) or 0 for r in all_results.values())
    print(f"\nDocuments processed: {len(all_results)}")
    print(f"Total lines extracted: {total_lines}")
    print(f"Total hours: {total_hours}")
    
    conn.close()
    return all_results


if __name__ == "__main__":
    main()
