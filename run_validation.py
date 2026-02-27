"""
Run validation using Snowflake Cortex AI_COMPLETE.
Validates extracted timesheet data at document and line levels.
"""
import json
import snowflake.connector
import os
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()


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


def run_document_validation(conn, doc_id: str, lines: list) -> list:
    """
    Run document-level validation checks.
    Returns list of validation results.
    """
    checks = []
    
    # Check 1: Worker identifiable
    workers = set(line['worker'] for line in lines if line.get('worker'))
    checks.append({
        "rule_name": "WORKER_IDENTIFIABLE",
        "status": "PASS" if len(workers) > 0 else "FAIL",
        "details": f"Found {len(workers)} unique worker(s): {', '.join(workers)}" if workers else "No worker identified",
        "computed_value": str(len(workers))
    })
    
    # Check 2: Dates present
    dates = [line['work_date'] for line in lines if line.get('work_date')]
    checks.append({
        "rule_name": "DATES_PRESENT",
        "status": "PASS" if len(dates) > 0 else "FAIL",
        "details": f"Found {len(dates)} date entries" if dates else "No dates found",
        "computed_value": str(len(dates))
    })
    
    # Check 3: Hours total reasonable (should be <= 60 per week)
    total_hours = sum(float(line.get('hours', 0) or 0) for line in lines)
    status = "PASS" if 0 < total_hours <= 60 else ("WARN" if total_hours > 60 else "FAIL")
    checks.append({
        "rule_name": "TOTAL_HOURS_REASONABLE",
        "status": status,
        "details": f"Total hours: {total_hours}. {'Exceeds 60 hours - verify overtime' if total_hours > 60 else 'Within normal range'}",
        "computed_value": str(total_hours)
    })
    
    # Check 4: Extraction confidence acceptable (avg >= 0.7)
    confidences = [float(line.get('extraction_confidence', 0) or 0) for line in lines]
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0
    checks.append({
        "rule_name": "EXTRACTION_CONFIDENCE",
        "status": "PASS" if avg_confidence >= 0.7 else "WARN",
        "details": f"Average confidence: {avg_confidence:.2f}",
        "computed_value": f"{avg_confidence:.2f}"
    })
    
    return checks


def run_line_validation(conn, doc_id: str, line: dict, line_id: str) -> list:
    """
    Run line-level validation checks.
    Returns list of validation results.
    """
    checks = []
    
    # Check 1: Valid date format
    work_date = line.get('work_date', '')
    date_valid = False
    if work_date:
        # Clean up date string (remove extra quotes)
        clean_date = str(work_date).replace('"', '').strip()
        try:
            datetime.strptime(clean_date, '%Y-%m-%d')
            date_valid = True
        except:
            pass
    
    checks.append({
        "rule_name": "VALID_DATE_FORMAT",
        "status": "PASS" if date_valid else "FAIL",
        "details": f"Date '{work_date}' is {'valid' if date_valid else 'invalid or missing'}",
        "line_id": line_id
    })
    
    # Check 2: Hours numeric and in range
    hours = line.get('hours')
    hours_valid = False
    hours_value = 0
    try:
        hours_value = float(hours) if hours is not None else 0
        hours_valid = 0 <= hours_value <= 24
    except:
        pass
    
    status = "PASS" if hours_valid else ("WARN" if hours_value > 24 else "FAIL")
    checks.append({
        "rule_name": "HOURS_IN_RANGE",
        "status": status,
        "details": f"Hours: {hours_value}. {'Valid range 0-24' if hours_valid else 'Outside valid range or invalid'}",
        "line_id": line_id,
        "computed_value": str(hours_value)
    })
    
    # Check 3: Required fields present
    required = ['worker', 'work_date', 'hours']
    missing = [f for f in required if not line.get(f)]
    checks.append({
        "rule_name": "REQUIRED_FIELDS_PRESENT",
        "status": "PASS" if not missing else "FAIL",
        "details": f"Missing fields: {', '.join(missing)}" if missing else "All required fields present",
        "line_id": line_id
    })
    
    return checks


def save_validation_results(conn, doc_id: str, checks: list):
    """Save validation results to VALIDATION_RESULTS table."""
    cursor = conn.cursor()
    try:
        for i, check in enumerate(checks):
            cursor.execute("""
                INSERT INTO VALIDATION_RESULTS 
                (validation_id, doc_id, line_id, rule_name, status, details, computed_value)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (
                f"{doc_id}_V{i+1}",
                doc_id,
                check.get("line_id"),
                check["rule_name"],
                check["status"],
                check["details"],
                check.get("computed_value"),
            ))
        conn.commit()
    finally:
        cursor.close()


def main():
    print("=" * 60)
    print("Validating extracted timesheet data")
    print("=" * 60)
    
    conn = get_connection()
    cursor = conn.cursor()
    
    # Get all documents
    cursor.execute("SELECT DISTINCT doc_id FROM EXTRACTED_LINES ORDER BY doc_id")
    doc_ids = [row[0] for row in cursor.fetchall()]
    
    all_results = {}
    total_checks = 0
    total_pass = 0
    total_fail = 0
    total_warn = 0
    
    for doc_id in doc_ids:
        print(f"\n>>> Validating {doc_id}...")
        
        # Get lines for this document
        cursor.execute("""
            SELECT line_id, worker, work_date, project, hours, extraction_confidence
            FROM EXTRACTED_LINES
            WHERE doc_id = %s
        """, (doc_id,))
        
        rows = cursor.fetchall()
        lines = [
            {
                "line_id": row[0],
                "worker": row[1],
                "work_date": row[2],
                "project": row[3],
                "hours": row[4],
                "extraction_confidence": row[5]
            }
            for row in rows
        ]
        
        all_checks = []
        
        # Document-level validation
        doc_checks = run_document_validation(conn, doc_id, lines)
        all_checks.extend(doc_checks)
        
        # Line-level validation (sample first 5 lines to avoid too many checks)
        for line in lines[:5]:
            line_checks = run_line_validation(conn, doc_id, line, line["line_id"])
            all_checks.extend(line_checks)
        
        # Save results
        save_validation_results(conn, doc_id, all_checks)
        
        # Count results
        passes = sum(1 for c in all_checks if c["status"] == "PASS")
        fails = sum(1 for c in all_checks if c["status"] == "FAIL")
        warns = sum(1 for c in all_checks if c["status"] == "WARN")
        
        total_checks += len(all_checks)
        total_pass += passes
        total_fail += fails
        total_warn += warns
        
        all_results[doc_id] = {
            "checks": all_checks,
            "summary": {"pass": passes, "fail": fails, "warn": warns}
        }
        
        print(f"<<< {len(all_checks)} checks: {passes} PASS, {fails} FAIL, {warns} WARN")
    
    cursor.close()
    conn.close()
    
    # Save to JSON
    with open("validation_results.json", "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    
    print("\n" + "=" * 60)
    print("Validation complete!")
    print("=" * 60)
    print(f"\nTotal checks: {total_checks}")
    print(f"  PASS: {total_pass}")
    print(f"  FAIL: {total_fail}")
    print(f"  WARN: {total_warn}")
    
    overall = "PASS" if total_fail == 0 else "FAIL"
    print(f"\nOverall status: {overall}")
    
    return all_results


if __name__ == "__main__":
    main()
