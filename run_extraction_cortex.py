"""
Run extraction using Snowflake Cortex multimodal (Claude 3.5 Sonnet vision).
Sends timesheet images directly to the LLM, bypassing OCR text entirely.
"""
import json
import snowflake.connector
import os
from dotenv import load_dotenv

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


def extract_with_multimodal(conn, doc_id: str, file_path: str) -> str:
    """
    Call the EXTRACT_DOCUMENT_MULTIMODAL stored procedure which sends
    the image directly to Claude 3.5 Sonnet via SNOWFLAKE.CORTEX.COMPLETE.
    Returns the procedure's status message.
    """
    cursor = conn.cursor()
    try:
        cursor.execute("CALL EXTRACT_DOCUMENT_MULTIMODAL(%s, %s)", (doc_id, file_path))
        result = cursor.fetchone()
        return result[0] if result else "No result returned"
    finally:
        cursor.close()


def main():
    print("=" * 60)
    print("Extracting timesheets using Cortex multimodal (Claude vision)")
    print("=" * 60)

    conn = get_connection()

    # Fetch documents from RAW_DOCUMENTS
    cursor = conn.cursor()
    cursor.execute("SELECT doc_id, doc_type, file_path FROM RAW_DOCUMENTS ORDER BY doc_id")
    documents = cursor.fetchall()
    cursor.close()

    results = {}

    for doc_id, doc_type, file_path in documents:
        print(f"\n>>> Processing {doc_id} ({file_path})...")

        try:
            status = extract_with_multimodal(conn, doc_id, file_path)
            results[doc_id] = status
            print(f"<<< {status}")
        except Exception as e:
            print(f"<<< ERROR: {e}")
            results[doc_id] = f"ERROR: {e}"

    # Verify results by querying EXTRACTED_LINES
    cursor = conn.cursor()
    cursor.execute("""
        SELECT doc_id, COUNT(*) AS line_count, SUM(hours) AS total_hours
        FROM EXTRACTED_LINES
        GROUP BY doc_id
        ORDER BY doc_id
    """)
    summary = cursor.fetchall()
    cursor.close()

    print("\n" + "=" * 60)
    print("Extraction complete!")
    print("=" * 60)
    print(f"\nDocuments processed: {len(results)}")
    print("\nPer-document summary (from EXTRACTED_LINES):")
    total_lines = 0
    total_hours = 0
    for doc_id, line_count, hours in summary:
        print(f"  {doc_id}: {line_count} lines, {hours:.1f} hours")
        total_lines += line_count
        total_hours += float(hours)

    print(f"\nTotal lines: {total_lines}")
    print(f"Total hours: {total_hours:.1f}")

    # Save status results to JSON
    with open("extraction_results.json", "w") as f:
        json.dump(results, f, indent=2, default=str)

    conn.close()
    return results


if __name__ == "__main__":
    main()
