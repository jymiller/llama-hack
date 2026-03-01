# Fix: EXTRACT_ALL_MULTIMODAL stored procedure bug

## The problem

When pressing "Run Pipeline" on the home page, the call to `EXTRACT_ALL_MULTIMODAL()` fails after ~30 seconds with:

```
Bind variable :pdf_doc_id not set.
```

## Root cause

In Snowflake Scripting, a `FOR variable IN cursor DO` loop **implicitly declares** its loop variable as a RECORD type — it does not use any scalar variable you pre-declared with the same name. So in the original code:

```sql
DECLARE
    pdf_cursor CURSOR FOR
        SELECT doc_id FROM RAW_DOCUMENTS WHERE file_path ILIKE '%.pdf';
    pdf_doc_id VARCHAR;   -- ← this is a separate, never-assigned VARCHAR
BEGIN
    FOR pdf_doc_id IN pdf_cursor DO   -- ← this creates a new RECORD named pdf_doc_id
        CALL EXTRACT_DOCUMENT_MULTIMODAL(:pdf_doc_id);  -- ← binds the unset VARCHAR, not the record
    END FOR;
END;
```

`:pdf_doc_id` in the `CALL` refers to the uninitialized `VARCHAR`, not the loop record.

## The fix

Use a different name for the loop record variable (`pdf_rec`), then assign `doc_id` from the record into the `VARCHAR` before calling:

```sql
DECLARE
    pdf_cursor CURSOR FOR
        SELECT doc_id FROM RAW_DOCUMENTS WHERE file_path ILIKE '%.pdf';
    pdf_doc_id VARCHAR;
BEGIN
    FOR pdf_rec IN pdf_cursor DO
        pdf_doc_id := pdf_rec.doc_id;
        CALL EXTRACT_DOCUMENT_MULTIMODAL(:pdf_doc_id);
    END FOR;
END;
```

This fix is already applied in `sql/setup.sql` (around line 544).

## How to deploy

The fix needs to be applied in Snowflake — the stored procedure lives there, not in the Docker image.

1. Open a Snowflake Worksheet
2. Set the context: `RECONCILIATION` database, `PUBLIC` schema
3. Use a role with `CREATE PROCEDURE` privilege (not the `USER` role — it lacks permission)
4. Paste and run the entire `CREATE OR REPLACE PROCEDURE EXTRACT_ALL_MULTIMODAL()` block from `sql/setup.sql` (lines 407–571)

## Notes

- This bug only triggers when there are **PDF files** in `RAW_DOCUMENTS`. If all your docs are images (jpg/png), the PDF cursor loop is skipped and extraction works fine.
- The image extraction path (the big set-based INSERT using `TO_FILE`) is unaffected by this bug.
- After deploying the fix, no Docker rebuild is needed — the Next.js app just calls `CALL EXTRACT_ALL_MULTIMODAL()` and the fixed version will run.
