-- Timesheet Reconciliation System - Snowflake Setup
-- Run this script to create the database, schema, stage, and tables

-- 1. Create database and schema
CREATE DATABASE IF NOT EXISTS RECONCILIATION;
USE DATABASE RECONCILIATION;
CREATE SCHEMA IF NOT EXISTS PUBLIC;
USE SCHEMA PUBLIC;

-- 2. Create stage for document uploads
CREATE STAGE IF NOT EXISTS DOCUMENTS_STAGE
    DIRECTORY = (ENABLE = TRUE)
    COMMENT = 'Stage for timesheet screenshots and invoice images';

-- 3. RAW_DOCUMENTS - Stores document metadata and OCR output
CREATE TABLE IF NOT EXISTS RAW_DOCUMENTS (
    doc_id VARCHAR(100) PRIMARY KEY,
    doc_type VARCHAR(50) NOT NULL,  -- TIMESHEET, SUBSUB_INVOICE, MY_INVOICE
    file_path VARCHAR(500) NOT NULL, -- Stage path: @DOCUMENTS_STAGE/filename.png
    ingested_ts TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    ocr_text TEXT,                   -- Raw OCR output from PARSE_DOCUMENT
    ocr_status VARCHAR(20) DEFAULT 'PENDING',  -- PENDING, COMPLETED, FAILED
    CONSTRAINT chk_doc_type CHECK (doc_type IN ('TIMESHEET', 'SUBSUB_INVOICE', 'MY_INVOICE'))
);

-- 4. EXTRACTED_LINES - Structured data extracted by CrewAI agent
CREATE TABLE IF NOT EXISTS EXTRACTED_LINES (
    line_id VARCHAR(100) PRIMARY KEY,
    doc_id VARCHAR(100) NOT NULL REFERENCES RAW_DOCUMENTS(doc_id),
    worker VARCHAR(200),
    work_date DATE,
    project VARCHAR(200),
    project_code VARCHAR(50),
    hours DECIMAL(5,2),
    extraction_confidence DECIMAL(3,2),  -- 0.00 to 1.00
    raw_text_snippet TEXT,
    raw_line_json VARIANT,
    created_ts TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- 5. VALIDATION_RESULTS - Validation checks performed by CrewAI agent
CREATE TABLE IF NOT EXISTS VALIDATION_RESULTS (
    validation_id VARCHAR(100) PRIMARY KEY,
    doc_id VARCHAR(100) NOT NULL REFERENCES RAW_DOCUMENTS(doc_id),
    line_id VARCHAR(100) REFERENCES EXTRACTED_LINES(line_id),
    rule_name VARCHAR(100) NOT NULL,
    status VARCHAR(10) NOT NULL,  -- PASS, FAIL, WARN
    details TEXT,
    computed_value VARCHAR(500),
    created_ts TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    CONSTRAINT chk_status CHECK (status IN ('PASS', 'FAIL', 'WARN'))
);

-- 6. RECON_SUMMARY - Reconciliation results
CREATE TABLE IF NOT EXISTS RECON_SUMMARY (
    recon_id VARCHAR(100) PRIMARY KEY DEFAULT UUID_STRING(),
    period_month VARCHAR(7) NOT NULL,    -- YYYY-MM
    period_quarter VARCHAR(7) NOT NULL,  -- YYYY-QN
    approved_hours DECIMAL(10,2),
    implied_cost DECIMAL(12,2),
    invoice_subsub_amount DECIMAL(12,2),
    invoice_my_amount DECIMAL(12,2),
    variance_subsub DECIMAL(12,2),
    variance_my DECIMAL(12,2),
    created_ts TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- 7. CURATED_GROUND_TRUTH - Financial analyst-entered correct data (curated)
CREATE TABLE IF NOT EXISTS CURATED_GROUND_TRUTH (
    gt_id VARCHAR(100) PRIMARY KEY DEFAULT UUID_STRING(),
    doc_id VARCHAR(100) NOT NULL REFERENCES RAW_DOCUMENTS(doc_id),
    worker VARCHAR(200),
    work_date DATE,
    project VARCHAR(200),
    project_code VARCHAR(20),
    hours DECIMAL(5,2),
    notes TEXT,
    entered_by VARCHAR(200) DEFAULT CURRENT_USER(),
    entered_ts TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    curation_note VARCHAR(1000)  -- e.g. "Corrected via fuzzy match: project_code 006QI→006GI"
);

-- 8. APPROVED_LINES - Analyst approve/reject/correct decisions per extracted line (curated)
CREATE TABLE IF NOT EXISTS APPROVED_LINES (
    approval_id VARCHAR(100) PRIMARY KEY DEFAULT UUID_STRING(),
    line_id VARCHAR(100) NOT NULL REFERENCES EXTRACTED_LINES(line_id),
    doc_id VARCHAR(100) NOT NULL REFERENCES RAW_DOCUMENTS(doc_id),
    decision VARCHAR(20) NOT NULL,  -- APPROVED, REJECTED, CORRECTED
    corrected_worker VARCHAR(200),
    corrected_date DATE,
    corrected_project VARCHAR(200),
    corrected_hours DECIMAL(5,2),
    reason TEXT,
    reviewer VARCHAR(200) DEFAULT CURRENT_USER(),
    reviewed_ts TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
    -- decision should be: APPROVED, REJECTED, or CORRECTED
);

-- 9. EXTRACTION_ACCURACY view - compare extracted vs ground truth
CREATE OR REPLACE VIEW EXTRACTION_ACCURACY AS
WITH gt AS (
    SELECT doc_id, worker, work_date, project, hours
    FROM CURATED_GROUND_TRUTH
),
ext AS (
    SELECT doc_id, line_id, worker, work_date, project, hours
    FROM EXTRACTED_LINES
),
matched AS (
    SELECT
        COALESCE(g.doc_id, e.doc_id) AS doc_id,
        e.line_id,
        g.worker AS gt_worker,
        e.worker AS ext_worker,
        COALESCE(g.work_date, e.work_date) AS work_date,
        g.project AS gt_project,
        e.project AS ext_project,
        COALESCE(g.hours, 0) AS gt_hours,
        COALESCE(e.hours, 0) AS ext_hours,
        ABS(COALESCE(e.hours, 0) - COALESCE(g.hours, 0)) AS hours_delta,
        CASE
            WHEN g.worker IS NULL THEN 'EXTRA_EXTRACTED'
            WHEN e.worker IS NULL THEN 'MISSING_EXTRACTED'
            WHEN ABS(e.hours - g.hours) < 0.01 AND e.work_date = g.work_date THEN 'MATCH'
            ELSE 'DISCREPANCY'
        END AS match_status
    FROM gt g
    FULL OUTER JOIN ext e
        ON g.doc_id = e.doc_id
        AND g.work_date = e.work_date
        AND g.project = e.project
)
SELECT
    doc_id,
    line_id,
    gt_worker,
    ext_worker,
    work_date,
    gt_project,
    ext_project,
    gt_hours,
    ext_hours,
    hours_delta,
    match_status,
    SUM(gt_hours) OVER (PARTITION BY doc_id)  AS total_gt_hours,
    SUM(ext_hours) OVER (PARTITION BY doc_id) AS total_ext_hours,
    CASE
        WHEN SUM(gt_hours) OVER (PARTITION BY doc_id) = 0 THEN 0.0
        ELSE GREATEST(0.0,
            (1.0 - ABS(SUM(ext_hours) OVER (PARTITION BY doc_id)
                       - SUM(gt_hours) OVER (PARTITION BY doc_id))
                   / NULLIF(SUM(gt_hours) OVER (PARTITION BY doc_id), 0)
            ) * 100.0
        )
    END AS hours_accuracy_pct
FROM matched;

-- 10. TRUSTED_LEDGER view - only approved/corrected lines
-- project_code is resolved through PROJECT_CODE_MERGES (non-destructive merge).
-- APPLY_PROJECT_MERGES proc performs the hard rewrite on EXTRACTED_LINES.
-- Nicknames from CURATED_WORKERS / CURATED_PROJECTS replace real names when set
-- (privacy control — set via Data Governance page).
CREATE OR REPLACE VIEW TRUSTED_LEDGER AS
SELECT
    e.line_id,
    e.doc_id,
    COALESCE(cw.nickname, COALESCE(a.corrected_worker, e.worker))   AS worker,
    COALESCE(a.corrected_date, e.work_date)                         AS work_date,
    COALESCE(m.target_code, e.project_code)                         AS project_code,
    COALESCE(cp.nickname, cp.project_name, COALESCE(a.corrected_project, e.project)) AS project,
    COALESCE(a.corrected_hours, e.hours)                            AS hours,
    a.decision AS approval_status,
    a.reviewer,
    a.reviewed_ts,
    e.extraction_confidence,
    e.raw_text_snippet
FROM EXTRACTED_LINES e
INNER JOIN APPROVED_LINES a ON e.line_id = a.line_id
LEFT  JOIN PROJECT_CODE_MERGES m  ON m.source_code  = e.project_code
LEFT  JOIN CURATED_PROJECTS    cp ON cp.project_code = COALESCE(m.target_code, e.project_code)
LEFT  JOIN CURATED_WORKERS     cw ON cw.worker_key   = LOWER(TRIM(COALESCE(a.corrected_worker, e.worker)))
WHERE a.decision IN ('APPROVED', 'CORRECTED');


-- 13. View for easy monitoring of pipeline status
CREATE OR REPLACE VIEW PIPELINE_STATUS AS
SELECT 
    d.doc_id,
    d.doc_type,
    d.ocr_status,
    COUNT(DISTINCT e.line_id) AS extracted_lines,
    COUNT(DISTINCT v.validation_id) AS validation_checks,
    SUM(CASE WHEN v.status = 'PASS' THEN 1 ELSE 0 END) AS checks_passed,
    SUM(CASE WHEN v.status = 'FAIL' THEN 1 ELSE 0 END) AS checks_failed,
    d.ingested_ts
FROM RAW_DOCUMENTS d
LEFT JOIN EXTRACTED_LINES e ON d.doc_id = e.doc_id
LEFT JOIN VALIDATION_RESULTS v ON d.doc_id = v.doc_id
GROUP BY d.doc_id, d.doc_type, d.ocr_status, d.ingested_ts
ORDER BY d.ingested_ts DESC;

-- Usage examples:
-- 
-- 1. Upload files to stage (from SnowSQL or Snowflake UI):
--    PUT file:///path/to/timesheet_jan.png @DOCUMENTS_STAGE;
--
-- 2. Process a single document:
--    CALL PROCESS_DOCUMENT_OCR('TS_2024_01', 'TIMESHEET', '@DOCUMENTS_STAGE/timesheet_jan.png');
--
-- 3. Process all new documents in stage:
--    CALL PROCESS_ALL_STAGED_DOCUMENTS();
--
-- 4. Check pipeline status:
--    SELECT * FROM PIPELINE_STATUS;
--
-- 5. View OCR output for a document:
--    SELECT doc_id, ocr_text FROM RAW_DOCUMENTS WHERE doc_id = 'TS_2024_01';

-- ============================================================
-- 14. EXTRACT_DOCUMENT_MULTIMODAL - Multimodal extraction via Claude vision
-- Sends the timesheet image directly to Claude 3.5 Sonnet, bypassing OCR.
-- ============================================================
CREATE OR REPLACE PROCEDURE EXTRACT_DOCUMENT_MULTIMODAL(
    P_DOC_ID VARCHAR,
    P_FILE_PATH VARCHAR
)
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
DECLARE
    llm_response TEXT;
    parsed VARIANT;
    lines_array VARIANT;
    line_obj VARIANT;
    i INTEGER;
    line_count INTEGER;
    line_id_val VARCHAR;
    worker_val VARCHAR;
    work_date_val VARCHAR;
    project_val VARCHAR;
    project_code_val VARCHAR;
    hours_val DECIMAL(5,2);
    confidence_val DECIMAL(3,2);
    snippet_val TEXT;
    filename VARCHAR;
    stage_ref VARCHAR;
    doc_type_val VARCHAR;
    extraction_prompt TEXT;
BEGIN
    -- Derive filename and stage reference from file_path
    -- e.g. '@RECONCILIATION.PUBLIC.DOCUMENTS_STAGE_UNENC/9-13-2025.jpg'
    filename  := REGEXP_REPLACE(:P_FILE_PATH, '^.*/', '');
    stage_ref := REGEXP_REPLACE(:P_FILE_PATH, '/[^/]+$', '');

    -- Look up doc type to select the right prompt
    SELECT DOC_TYPE INTO doc_type_val FROM RAW_DOCUMENTS WHERE DOC_ID = :P_DOC_ID;

    IF (:doc_type_val = 'SUBSUB_INVOICE') THEN
        extraction_prompt := 'You are extracting structured data from a subcontractor invoice PDF.

The invoice is submitted by a subcontractor or worker billing for hours worked during a specific period (typically a month).

=== OUTPUT FORMAT ===
Return ONLY valid JSON (no markdown, no extra text):
{
  "lines": [
    {
      "worker": "Full name of the subcontractor or company on the invoice",
      "work_date": "Last calendar day of the billing period as YYYY-MM-DD (e.g. September 2025 = 2025-09-30)",
      "project": "Client or project/engagement name if visible, otherwise null",
      "project_code": "Project or engagement code if visible (alphanumeric), otherwise null",
      "hours": 160.0,
      "extraction_confidence": 0.95,
      "raw_text_snippet": "Key text confirming this reading"
    }
  ]
}

=== EXTRACTION RULES ===
- If the invoice has multiple line items (different weeks, projects, or services), produce one JSON object per line item
- If the invoice shows only a single total, produce one JSON object for the total
- work_date: use the LAST calendar day of the billing period month (e.g. September 2025 → 2025-09-30; October 2025 → 2025-10-31)
- hours: extract hours billed as a decimal. Do NOT extract dollar amounts as hours.
- worker: the subcontractor or company name at the top of the invoice (the FROM party)
- project: the client name, project name, or engagement description (the TO party or service description)
- project_code: any alphanumeric project/engagement code if visible, otherwise null
- extraction_confidence: 0.95 if clearly readable, 0.75 if partially obscured';
    ELSE
        extraction_prompt := 'You are extracting structured data from a NetSuite Weekly Timesheet screenshot.

=== STEP 1: FIND THE "Time Details" TABLE ===
Scroll to the BOTTOM of the image. There is a "Time Details (N)" section. This is the CLEANEST data source — use it as your primary reference. It shows:
- A left column: each project row beginning with a 15-char Salesforce code (e.g. "006GI00000P4aPt Randstad...")
- 7 day-of-week columns: SAT | SUN | MON | TUE | WED | THU | FRI with calendar date numbers beneath (e.g. SAT=6, SUN=7, MON=8)
- Hour values per cell (H:MM or H.HH format — treat the same; 2:00 = 2.0, 4:30 = 4.5)
- A TOTAL column on the right — use this to verify your row sums

=== STEP 2: COMPUTE EXACT DATES ===
- Find "WEEK OF" in the header. This date is ALWAYS a SATURDAY (the first day of the NetSuite week).
- Map columns: SAT=WEEK_OF+0, SUN=+1, MON=+2, TUE=+3, WED=+4, THU=+5, FRI=+6
- Use the date numbers shown in the column headers to confirm (e.g. "MON 8" means the 8th of the current month)
- Output all dates as YYYY-MM-DD

=== STEP 3: READ PROJECT CODES PRECISELY ===
- Each Time Details row starts with a 15-character Salesforce ID, ALWAYS beginning with "006"
- Read character-by-character — these are case-sensitive. Common visual confusion: 0 (zero) vs O (letter O), I vs l vs 1, Q vs O, B vs 8
- The code ends where the project description text begins (usually after a space before "Randstad" or "Snowflake")
- Also cross-check the "Enter Time" grid in the middle of the image where the same codes appear in the leftmost column

=== OUTPUT FORMAT ===
Return ONLY valid JSON (no markdown, no extra text):
{
  "lines": [
    {
      "worker": "Full name from header",
      "work_date": "YYYY-MM-DD",
      "project": "Full project name without the code prefix",
      "project_code": "006GI00000P4aPt",
      "hours": 2.0,
      "extraction_confidence": 0.95,
      "raw_text_snippet": "Time Details: 006GI00000P4aPt MON 9/8 = 2.00"
    }
  ]
}

=== EXTRACTION RULES ===
- Extract every non-zero hour entry. One JSON object per (project × day) where hours > 0.
- Do NOT skip project rows. If Time Details shows N rows, produce one object per non-zero cell across all N rows.
- Worker name comes from the timesheet header (e.g. "Mike Agrawal (V)").
- extraction_confidence: 0.95 if clearly readable, 0.75 if partially obscured.
- Verify each row total matches the TOTAL column in Time Details before finalizing.';
    END IF;

    -- Call Claude 3.5 Sonnet: use PARSE_DOCUMENT→text for invoice PDFs, multimodal for images
    IF (:doc_type_val = 'SUBSUB_INVOICE' AND :filename ILIKE '%.pdf') THEN
        DECLARE ocr_text TEXT;
        BEGIN
            SELECT SNOWFLAKE.CORTEX.PARSE_DOCUMENT(:stage_ref, :filename, {'mode': 'LAYOUT'})::VARCHAR INTO ocr_text;
            SELECT SNOWFLAKE.CORTEX.COMPLETE(
                'claude-3-5-sonnet',
                :extraction_prompt || CHR(10) || CHR(10) || 'Document text:' || CHR(10) || :ocr_text
            ) INTO llm_response;
        END;
    ELSE
        SELECT SNOWFLAKE.CORTEX.COMPLETE(
            'claude-3-5-sonnet',
            :extraction_prompt,
            TO_FILE(:stage_ref, :filename)
        ) INTO llm_response;
    END IF;

    -- Strip markdown code fences if present
    llm_response := REGEXP_REPLACE(:llm_response, '^```(json)?\\s*', '');
    llm_response := REGEXP_REPLACE(:llm_response, '\\s*```$', '');

    -- Parse the JSON response
    parsed := PARSE_JSON(:llm_response);
    lines_array := :parsed:lines;
    line_count := ARRAY_SIZE(:lines_array);

    -- Delete old data for this doc (idempotent re-extraction)
    DELETE FROM APPROVED_LINES WHERE doc_id = :P_DOC_ID;
    DELETE FROM VALIDATION_RESULTS WHERE doc_id = :P_DOC_ID;
    DELETE FROM EXTRACTED_LINES WHERE doc_id = :P_DOC_ID;

    -- Insert each extracted line
    i := 0;
    WHILE (:i < :line_count) DO
        line_obj := GET(:lines_array, :i);
        line_id_val := :P_DOC_ID || '_L' || (:i + 1)::VARCHAR;
        worker_val := :line_obj:worker::VARCHAR;
        work_date_val := :line_obj:work_date::VARCHAR;
        project_val := :line_obj:project::VARCHAR;
        project_code_val := :line_obj:project_code::VARCHAR;
        hours_val := :line_obj:hours::DECIMAL(5,2);
        confidence_val := :line_obj:extraction_confidence::DECIMAL(3,2);
        snippet_val := :line_obj:raw_text_snippet::VARCHAR;

        INSERT INTO EXTRACTED_LINES
            (line_id, doc_id, worker, work_date, project, project_code, hours,
             extraction_confidence, raw_text_snippet, raw_line_json)
        VALUES
            (:line_id_val, :P_DOC_ID, :worker_val, :work_date_val::DATE, :project_val,
             :project_code_val, :hours_val, :confidence_val, :snippet_val, :line_obj);

        i := :i + 1;
    END WHILE;

    -- Update document status
    UPDATE RAW_DOCUMENTS
    SET ocr_status = 'COMPLETED'
    WHERE doc_id = :P_DOC_ID;

    RETURN 'SUCCESS: Extracted ' || :line_count || ' lines from ' || :P_DOC_ID || ' via multimodal';
EXCEPTION
    WHEN OTHER THEN
        RETURN 'ERROR: ' || SQLERRM;
END;
$$;


-- ============================================================
-- 15. EXTRACT_ALL_MULTIMODAL - Parallel set-based multimodal extraction
-- Sends ALL document images to Claude in a single SELECT, letting
-- Snowflake parallelise the CORTEX.COMPLETE calls across rows.
-- ============================================================
CREATE OR REPLACE PROCEDURE EXTRACT_ALL_MULTIMODAL()
RETURNS TABLE (doc_id VARCHAR, status VARCHAR)
LANGUAGE SQL
AS
$$
DECLARE
    timesheet_prompt TEXT;
    invoice_prompt TEXT;
    res RESULTSET;
BEGIN
    timesheet_prompt := 'You are extracting structured data from a NetSuite Weekly Timesheet screenshot.

=== STEP 1: FIND THE "Time Details" TABLE ===
Scroll to the BOTTOM of the image. There is a "Time Details (N)" section. This is the CLEANEST data source — use it as your primary reference. It shows:
- A left column: each project row beginning with a 15-char Salesforce code (e.g. "006GI00000P4aPt Randstad...")
- 7 day-of-week columns: SAT | SUN | MON | TUE | WED | THU | FRI with calendar date numbers beneath (e.g. SAT=6, SUN=7, MON=8)
- Hour values per cell (H:MM or H.HH format — treat the same; 2:00 = 2.0, 4:30 = 4.5)
- A TOTAL column on the right — use this to verify your row sums

=== STEP 2: COMPUTE EXACT DATES ===
- Find "WEEK OF" in the header. This date is ALWAYS a SATURDAY (the first day of the NetSuite week).
- Map columns: SAT=WEEK_OF+0, SUN=+1, MON=+2, TUE=+3, WED=+4, THU=+5, FRI=+6
- Use the date numbers shown in the column headers to confirm (e.g. "MON 8" means the 8th of the current month)
- Output all dates as YYYY-MM-DD

=== STEP 3: READ PROJECT CODES PRECISELY ===
- Each Time Details row starts with a 15-character Salesforce ID, ALWAYS beginning with "006"
- Read character-by-character — these are case-sensitive. Common visual confusion: 0 (zero) vs O (letter O), I vs l vs 1, Q vs O, B vs 8
- The code ends where the project description text begins (usually after a space before "Randstad" or "Snowflake")
- Also cross-check the "Enter Time" grid in the middle of the image where the same codes appear in the leftmost column

=== OUTPUT FORMAT ===
Return ONLY valid JSON (no markdown, no extra text):
{
  "lines": [
    {
      "worker": "Full name from header",
      "work_date": "YYYY-MM-DD",
      "project": "Full project name without the code prefix",
      "project_code": "006GI00000P4aPt",
      "hours": 2.0,
      "extraction_confidence": 0.95,
      "raw_text_snippet": "Time Details: 006GI00000P4aPt MON 9/8 = 2.00"
    }
  ]
}

=== EXTRACTION RULES ===
- Extract every non-zero hour entry. One JSON object per (project × day) where hours > 0.
- Do NOT skip project rows. If Time Details shows N rows, produce one object per non-zero cell across all N rows.
- Worker name comes from the timesheet header (e.g. "Mike Agrawal (V)").
- extraction_confidence: 0.95 if clearly readable, 0.75 if partially obscured.
- Verify each row total matches the TOTAL column in Time Details before finalizing.';

    invoice_prompt := 'You are extracting structured data from a subcontractor invoice PDF.

The invoice is submitted by a subcontractor or worker billing for hours worked during a specific period (typically a month).

=== OUTPUT FORMAT ===
Return ONLY valid JSON (no markdown, no extra text):
{
  "lines": [
    {
      "worker": "Full name of the subcontractor or company on the invoice",
      "work_date": "Last calendar day of the billing period as YYYY-MM-DD (e.g. September 2025 = 2025-09-30)",
      "project": "Client or project/engagement name if visible, otherwise null",
      "project_code": "Project or engagement code if visible (alphanumeric), otherwise null",
      "hours": 160.0,
      "extraction_confidence": 0.95,
      "raw_text_snippet": "Key text confirming this reading"
    }
  ]
}

=== EXTRACTION RULES ===
- If the invoice has multiple line items (different weeks, projects, or services), produce one JSON object per line item
- If the invoice shows only a single total, produce one JSON object for the total
- work_date: use the LAST calendar day of the billing period month (e.g. September 2025 → 2025-09-30; October 2025 → 2025-10-31)
- hours: extract hours billed as a decimal. Do NOT extract dollar amounts as hours.
- worker: the subcontractor or company name at the top of the invoice (the FROM party)
- project: the client name, project name, or engagement description (the TO party or service description)
- project_code: any alphanumeric project/engagement code if visible, otherwise null
- extraction_confidence: 0.95 if clearly readable, 0.75 if partially obscured';

    -- Clean out old extracted data (idempotent re-extraction)
    DELETE FROM APPROVED_LINES    WHERE doc_id IN (SELECT doc_id FROM RAW_DOCUMENTS);
    DELETE FROM VALIDATION_RESULTS WHERE doc_id IN (SELECT doc_id FROM RAW_DOCUMENTS);
    DELETE FROM EXTRACTED_LINES    WHERE doc_id IN (SELECT doc_id FROM RAW_DOCUMENTS);

    -- Single set-based INSERT: Snowflake parallelises CORTEX.COMPLETE across rows
    INSERT INTO EXTRACTED_LINES
        (line_id, doc_id, worker, work_date, project, project_code, hours,
         extraction_confidence, raw_text_snippet, raw_line_json)
    WITH raw_responses AS (
        SELECT
            d.doc_id,
            REGEXP_REPLACE(d.file_path, '^.*/', '') AS filename,
            SNOWFLAKE.CORTEX.COMPLETE(
                'claude-3-5-sonnet',
                CASE d.doc_type WHEN 'SUBSUB_INVOICE' THEN :invoice_prompt ELSE :timesheet_prompt END,
                TO_FILE(REGEXP_REPLACE(d.file_path, '/[^/]+$', ''), REGEXP_REPLACE(d.file_path, '^.*/', ''))
            ) AS llm_response
        FROM RAW_DOCUMENTS d
    ),
    cleaned AS (
        SELECT
            doc_id,
            PARSE_JSON(
                REGEXP_REPLACE(
                    REGEXP_REPLACE(llm_response, '^```(json)?\\s*', ''),
                    '\\s*```$', ''
                )
            ) AS parsed
        FROM raw_responses
    ),
    flattened AS (
        SELECT
            c.doc_id,
            ROW_NUMBER() OVER (PARTITION BY c.doc_id ORDER BY f.index) AS line_num,
            f.value AS line_obj
        FROM cleaned c,
        LATERAL FLATTEN(input => c.parsed:lines) f
    )
    SELECT
        doc_id || '_L' || line_num::VARCHAR        AS line_id,
        doc_id,
        line_obj:worker::VARCHAR                    AS worker,
        line_obj:work_date::DATE                    AS work_date,
        line_obj:project::VARCHAR                   AS project,
        line_obj:project_code::VARCHAR              AS project_code,
        line_obj:hours::DECIMAL(5,2)                AS hours,
        line_obj:extraction_confidence::DECIMAL(3,2) AS extraction_confidence,
        line_obj:raw_text_snippet::VARCHAR           AS raw_text_snippet,
        line_obj                                     AS raw_line_json
    FROM flattened;

    -- Mark all docs as completed
    UPDATE RAW_DOCUMENTS SET ocr_status = 'COMPLETED';

    -- Build results summary
    CREATE OR REPLACE TEMPORARY TABLE multimodal_results (doc_id VARCHAR, status VARCHAR);
    INSERT INTO multimodal_results
        SELECT doc_id,
               'SUCCESS: Extracted ' || COUNT(*) || ' lines from ' || doc_id || ' via multimodal (parallel)'
        FROM EXTRACTED_LINES
        GROUP BY doc_id;

    res := (SELECT * FROM multimodal_results ORDER BY doc_id);
    RETURN TABLE(res);
END;
$$;


-- ============================================================
-- 16. POPULATE_RECON_SUMMARY - Compute and upsert reconciliation by month
-- Call with an hourly rate; derives invoice amounts from SUBSUB_INVOICE
-- and MY_INVOICE extracted hours × rate.
-- ============================================================
CREATE OR REPLACE PROCEDURE POPULATE_RECON_SUMMARY(P_HOURLY_RATE FLOAT)
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
BEGIN
    MERGE INTO RECON_SUMMARY t
    USING (
        WITH timesheet_hours AS (
            SELECT
                TO_VARCHAR(DATE_TRUNC('MONTH', work_date), 'YYYY-MM')          AS period_month,
                YEAR(work_date)::VARCHAR || '-Q' || QUARTER(work_date)::VARCHAR AS period_quarter,
                SUM(hours) AS approved_hours
            FROM TRUSTED_LEDGER
            GROUP BY 1, 2
        ),
        subsub_hours AS (
            SELECT
                TO_VARCHAR(DATE_TRUNC('MONTH', e.work_date), 'YYYY-MM') AS period_month,
                SUM(e.hours) AS invoice_hours
            FROM EXTRACTED_LINES e
            JOIN RAW_DOCUMENTS d ON e.doc_id = d.doc_id
            WHERE d.doc_type = 'SUBSUB_INVOICE'
            GROUP BY 1
        ),
        my_hours AS (
            SELECT
                TO_VARCHAR(DATE_TRUNC('MONTH', e.work_date), 'YYYY-MM') AS period_month,
                SUM(e.hours) AS invoice_hours
            FROM EXTRACTED_LINES e
            JOIN RAW_DOCUMENTS d ON e.doc_id = d.doc_id
            WHERE d.doc_type = 'MY_INVOICE'
            GROUP BY 1
        )
        SELECT
            t.period_month,
            t.period_quarter,
            t.approved_hours,
            t.approved_hours * :P_HOURLY_RATE                              AS implied_cost,
            COALESCE(s.invoice_hours, 0) * :P_HOURLY_RATE                  AS invoice_subsub_amount,
            COALESCE(m.invoice_hours, 0) * :P_HOURLY_RATE                  AS invoice_my_amount,
            (COALESCE(s.invoice_hours, 0) - t.approved_hours) * :P_HOURLY_RATE AS variance_subsub,
            (COALESCE(m.invoice_hours, 0) - t.approved_hours) * :P_HOURLY_RATE AS variance_my
        FROM timesheet_hours t
        LEFT JOIN subsub_hours s ON t.period_month = s.period_month
        LEFT JOIN my_hours    m ON t.period_month = m.period_month
    ) s ON t.period_month = s.period_month
    WHEN MATCHED THEN UPDATE SET
        period_quarter        = s.period_quarter,
        approved_hours        = s.approved_hours,
        implied_cost          = s.implied_cost,
        invoice_subsub_amount = s.invoice_subsub_amount,
        invoice_my_amount     = s.invoice_my_amount,
        variance_subsub       = s.variance_subsub,
        variance_my           = s.variance_my
    WHEN NOT MATCHED THEN INSERT
        (recon_id, period_month, period_quarter, approved_hours, implied_cost,
         invoice_subsub_amount, invoice_my_amount, variance_subsub, variance_my)
    VALUES
        (UUID_STRING(), s.period_month, s.period_quarter, s.approved_hours, s.implied_cost,
         s.invoice_subsub_amount, s.invoice_my_amount, s.variance_subsub, s.variance_my);

    RETURN 'SUCCESS: Reconciliation summary populated for '
        || (SELECT COUNT(*)::VARCHAR FROM RECON_SUMMARY) || ' month(s)';
EXCEPTION
    WHEN OTHER THEN
        RETURN 'ERROR: ' || SQLERRM;
END;
$$;


-- ============================================================
-- 17. RUN_VALIDATION - Apply all validation rules to EXTRACTED_LINES
-- Mirrors the logic in run_validation.py but runs entirely in Snowflake.
-- Safe to call repeatedly; clears and rebuilds results each time.
-- ============================================================
CREATE OR REPLACE PROCEDURE RUN_VALIDATION()
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
BEGIN
    -- Clear previous results (idempotent re-run)
    DELETE FROM VALIDATION_RESULTS
    WHERE doc_id IN (SELECT DISTINCT doc_id FROM EXTRACTED_LINES);

    -- ── Document-level checks (one row per doc) ───────────────

    -- WORKER_IDENTIFIABLE
    INSERT INTO VALIDATION_RESULTS
        (validation_id, doc_id, rule_name, status, details, computed_value)
    SELECT
        UUID_STRING(), doc_id, 'WORKER_IDENTIFIABLE',
        CASE WHEN COUNT(DISTINCT worker) > 0 THEN 'PASS' ELSE 'FAIL' END,
        CASE WHEN COUNT(DISTINCT worker) > 0
             THEN 'Found ' || COUNT(DISTINCT worker)::VARCHAR || ' unique worker(s)'
             ELSE 'No worker identified' END,
        COUNT(DISTINCT worker)::VARCHAR
    FROM EXTRACTED_LINES
    GROUP BY doc_id;

    -- DATES_PRESENT
    INSERT INTO VALIDATION_RESULTS
        (validation_id, doc_id, rule_name, status, details, computed_value)
    SELECT
        UUID_STRING(), doc_id, 'DATES_PRESENT',
        CASE WHEN COUNT(work_date) > 0 THEN 'PASS' ELSE 'FAIL' END,
        'Found ' || COUNT(work_date)::VARCHAR || ' date entries',
        COUNT(work_date)::VARCHAR
    FROM EXTRACTED_LINES
    GROUP BY doc_id;

    -- TOTAL_HOURS_REASONABLE (PASS ≤60, WARN >60, FAIL =0)
    INSERT INTO VALIDATION_RESULTS
        (validation_id, doc_id, rule_name, status, details, computed_value)
    SELECT
        UUID_STRING(), doc_id, 'TOTAL_HOURS_REASONABLE',
        CASE
            WHEN SUM(hours) > 60 THEN 'WARN'
            WHEN SUM(hours) > 0  THEN 'PASS'
            ELSE 'FAIL'
        END,
        'Total hours: ' || SUM(hours)::VARCHAR ||
        CASE WHEN SUM(hours) > 60 THEN '. Exceeds 60 - verify overtime' ELSE '' END,
        SUM(hours)::VARCHAR
    FROM EXTRACTED_LINES
    GROUP BY doc_id;

    -- EXTRACTION_CONFIDENCE (PASS ≥0.7, WARN <0.7)
    INSERT INTO VALIDATION_RESULTS
        (validation_id, doc_id, rule_name, status, details, computed_value)
    SELECT
        UUID_STRING(), doc_id, 'EXTRACTION_CONFIDENCE',
        CASE WHEN AVG(extraction_confidence) >= 0.7 THEN 'PASS' ELSE 'WARN' END,
        'Average confidence: ' || ROUND(AVG(extraction_confidence), 2)::VARCHAR,
        ROUND(AVG(extraction_confidence), 2)::VARCHAR
    FROM EXTRACTED_LINES
    GROUP BY doc_id;

    -- ── Line-level checks (one row per extracted line) ────────

    -- VALID_DATE_FORMAT
    INSERT INTO VALIDATION_RESULTS
        (validation_id, doc_id, line_id, rule_name, status, details)
    SELECT
        UUID_STRING(), doc_id, line_id, 'VALID_DATE_FORMAT',
        CASE WHEN work_date IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
        CASE WHEN work_date IS NOT NULL
             THEN 'Date ' || work_date::VARCHAR || ' is valid'
             ELSE 'Date is missing or invalid' END
    FROM EXTRACTED_LINES;

    -- HOURS_IN_RANGE (PASS 0-24, WARN >24, FAIL null)
    INSERT INTO VALIDATION_RESULTS
        (validation_id, doc_id, line_id, rule_name, status, details, computed_value)
    SELECT
        UUID_STRING(), doc_id, line_id, 'HOURS_IN_RANGE',
        CASE
            WHEN hours IS NULL       THEN 'FAIL'
            WHEN hours > 24          THEN 'WARN'
            WHEN hours >= 0          THEN 'PASS'
            ELSE 'FAIL'
        END,
        'Hours: ' || COALESCE(hours::VARCHAR, 'NULL') ||
        CASE
            WHEN hours IS NULL THEN '. Missing'
            WHEN hours > 24    THEN '. Exceeds 24 - verify'
            ELSE '. Valid range 0-24'
        END,
        COALESCE(hours::VARCHAR, 'NULL')
    FROM EXTRACTED_LINES;

    -- REQUIRED_FIELDS_PRESENT
    INSERT INTO VALIDATION_RESULTS
        (validation_id, doc_id, line_id, rule_name, status, details)
    SELECT
        UUID_STRING(), doc_id, line_id, 'REQUIRED_FIELDS_PRESENT',
        CASE WHEN worker IS NOT NULL AND work_date IS NOT NULL AND hours IS NOT NULL
             THEN 'PASS' ELSE 'FAIL' END,
        CASE WHEN worker IS NOT NULL AND work_date IS NOT NULL AND hours IS NOT NULL
             THEN 'All required fields present'
             ELSE 'Missing required field(s)' END
    FROM EXTRACTED_LINES;

    RETURN 'SUCCESS: Validated '
        || (SELECT COUNT(DISTINCT doc_id)::VARCHAR FROM VALIDATION_RESULTS)
        || ' document(s), '
        || (SELECT COUNT(*)::VARCHAR FROM VALIDATION_RESULTS)
        || ' total checks';
EXCEPTION
    WHEN OTHER THEN
        RETURN 'ERROR: ' || SQLERRM;
END;
$$;


-- ============================================================
-- 18. CURATED_PROJECTS - Master list of known project codes (curated)
-- Populated automatically by SYNC_CURATED_MASTER; confirmed by analysts.
-- curation_source: 'auto_extracted' | 'fuzzy_match' | 'manual'
-- curation_note: describes what changed, e.g. for fuzzy_match entries records
--   the original extracted code and edit distance to the confirmed master code.
-- ============================================================
CREATE TABLE IF NOT EXISTS CURATED_PROJECTS (
    project_code      VARCHAR(20)   NOT NULL PRIMARY KEY,
    project_name      VARCHAR(500),
    nickname          VARCHAR(200),
        -- privacy alias shown instead of project_name in all output views
    confirmed         BOOLEAN       DEFAULT FALSE,
    is_active         BOOLEAN       DEFAULT TRUE,
    first_seen        DATE,
    added_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    curation_source   VARCHAR(20)   DEFAULT 'auto_extracted',
        -- 'auto_extracted' = appeared in EXTRACTED_LINES, awaiting review
        -- 'fuzzy_match'    = auto-linked to a confirmed code by EDITDISTANCE ≤ 3
        -- 'manual'         = analyst added or edited directly
    curation_note     VARCHAR(1000),
        -- e.g. "Auto-matched from extracted code '006QI00000OBRL'
        --       (edit_dist=1 to confirmed '006GI00000OBRL' — likely G→Q misread)"
    matched_from_code VARCHAR(20)
        -- original extracted code when curation_source = 'fuzzy_match'
);
ALTER TABLE CURATED_PROJECTS ADD COLUMN IF NOT EXISTS nickname VARCHAR(200);

-- ============================================================
-- 19. CURATED_WORKERS - Master list of known workers (curated)
-- worker_key is the normalised lower-case trim of the display name.
-- ============================================================
CREATE TABLE IF NOT EXISTS CURATED_WORKERS (
    worker_key        VARCHAR(200)  NOT NULL PRIMARY KEY,  -- LOWER(TRIM(display_name))
    display_name      VARCHAR(200),
    nickname          VARCHAR(200),
        -- privacy alias shown instead of display_name in all output views
    confirmed         BOOLEAN       DEFAULT FALSE,
    is_active         BOOLEAN       DEFAULT TRUE,
    first_seen        DATE,
    added_at          TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP(),
    curation_source   VARCHAR(20)   DEFAULT 'auto_extracted',
        -- 'auto_extracted' | 'fuzzy_match' | 'manual'
    curation_note     VARCHAR(1000)
        -- e.g. "Normalised from 'Mike Agrawal (V)'; (V) denotes vendor status"
);
ALTER TABLE CURATED_WORKERS ADD COLUMN IF NOT EXISTS nickname VARCHAR(200);

-- ============================================================
-- 20. PROJECT_CODE_SUSPECTS view
-- Extracted lines whose project_code is not in confirmed master AND
-- is within edit-distance 3 of a confirmed code — likely OCR misreads.
-- ============================================================
CREATE OR REPLACE VIEW PROJECT_CODE_SUSPECTS AS
SELECT
    e.doc_id,
    e.line_id,
    e.project_code        AS extracted_code,
    m.project_code        AS master_code,
    m.project_name        AS master_name,
    EDITDISTANCE(e.project_code, m.project_code) AS edit_dist
FROM EXTRACTED_LINES e
JOIN CURATED_PROJECTS m
    ON m.confirmed = TRUE
    AND e.project_code != m.project_code
    AND EDITDISTANCE(e.project_code, m.project_code) BETWEEN 1 AND 3
WHERE e.project_code NOT IN (
    SELECT project_code FROM CURATED_PROJECTS WHERE confirmed = TRUE
)
ORDER BY edit_dist, e.doc_id;

-- ============================================================
-- 21. WORKER_NAME_SUSPECTS view
-- Extracted workers not in confirmed master AND within edit-distance 3.
-- ============================================================
CREATE OR REPLACE VIEW WORKER_NAME_SUSPECTS AS
SELECT
    e.doc_id,
    e.line_id,
    e.worker              AS extracted_worker,
    m.worker_key,
    m.display_name        AS master_display_name,
    EDITDISTANCE(LOWER(TRIM(e.worker)), m.worker_key) AS edit_dist
FROM EXTRACTED_LINES e
JOIN CURATED_WORKERS m
    ON m.confirmed = TRUE
    AND LOWER(TRIM(e.worker)) != m.worker_key
    AND EDITDISTANCE(LOWER(TRIM(e.worker)), m.worker_key) BETWEEN 1 AND 3
WHERE LOWER(TRIM(e.worker)) NOT IN (
    SELECT worker_key FROM CURATED_WORKERS WHERE confirmed = TRUE
)
ORDER BY edit_dist, e.doc_id;

-- ============================================================
-- 22. SYNC_CURATED_MASTER - Auto-populate curated master tables from
-- EXTRACTED_LINES. New codes/workers land as confirmed=FALSE (queue for review).
-- Call this after every extraction run.
-- ============================================================
CREATE OR REPLACE PROCEDURE SYNC_CURATED_MASTER()
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
DECLARE
    new_projects INTEGER;
    new_workers  INTEGER;
BEGIN
    -- New project codes not yet in master
    INSERT INTO CURATED_PROJECTS
        (project_code, project_name, first_seen, curation_source, curation_note)
    SELECT
        e.project_code,
        MIN(e.project),
        MIN(e.work_date),
        'auto_extracted',
        'Auto-populated from EXTRACTED_LINES on ' || CURRENT_DATE::VARCHAR
    FROM EXTRACTED_LINES e
    WHERE e.project_code IS NOT NULL
      AND e.project_code NOT IN (SELECT project_code FROM CURATED_PROJECTS)
    GROUP BY e.project_code;

    new_projects := SQLROWCOUNT;

    -- New workers not yet in master (normalise to lower-case key)
    INSERT INTO CURATED_WORKERS
        (worker_key, display_name, first_seen, curation_source, curation_note)
    SELECT
        LOWER(TRIM(e.worker)),
        MIN(e.worker),
        MIN(e.work_date),
        'auto_extracted',
        'Auto-populated from EXTRACTED_LINES on ' || CURRENT_DATE::VARCHAR
    FROM EXTRACTED_LINES e
    WHERE e.worker IS NOT NULL
      AND LOWER(TRIM(e.worker)) NOT IN (SELECT worker_key FROM CURATED_WORKERS)
    GROUP BY LOWER(TRIM(e.worker));

    new_workers := SQLROWCOUNT;

    -- Flag extracted codes that are fuzzy-close to a confirmed master code
    -- (edit-distance 1-3) but not already in the master.
    -- Updates curation_source and writes a descriptive curation_note.
    UPDATE CURATED_PROJECTS cp
    SET
        curation_source   = 'fuzzy_match',
        curation_note     = 'Auto-matched from extracted code ''' || cp.project_code
                            || ''' (edit_dist='
                            || EDITDISTANCE(cp.project_code, s.master_code)::VARCHAR
                            || ' to confirmed ''' || s.master_code
                            || ''' — possible OCR misread)',
        matched_from_code = cp.project_code
    FROM (
        SELECT DISTINCT
            e.project_code AS extracted_code,
            m.project_code AS master_code
        FROM EXTRACTED_LINES e
        JOIN CURATED_PROJECTS m
            ON m.confirmed = TRUE
            AND e.project_code != m.project_code
            AND EDITDISTANCE(e.project_code, m.project_code) BETWEEN 1 AND 3
        WHERE e.project_code NOT IN (
            SELECT project_code FROM CURATED_PROJECTS WHERE confirmed = TRUE
        )
    ) s
    WHERE cp.project_code = s.extracted_code
      AND cp.curation_source = 'auto_extracted';

    RETURN 'SUCCESS: Added ' || :new_projects::VARCHAR || ' project(s), '
        || :new_workers::VARCHAR || ' worker(s) to curated master';
EXCEPTION
    WHEN OTHER THEN
        RETURN 'ERROR: ' || SQLERRM;
END;
$$;


-- ============================================================
-- 23. PROJECT_CODE_MERGES - Audit trail of source→target code merges (curated)
-- Records every deliberate merge of a misread/duplicate code to its canonical form.
-- UNIQUE on source_code: each misread code has exactly one canonical target.
-- ============================================================
CREATE TABLE IF NOT EXISTS PROJECT_CODE_MERGES (
    merge_id     VARCHAR(100)  NOT NULL PRIMARY KEY DEFAULT UUID_STRING(),
    source_code  VARCHAR(20)   NOT NULL UNIQUE,   -- misread / duplicate code
    target_code  VARCHAR(20)   NOT NULL,           -- canonical code to merge into
    merge_reason VARCHAR(1000),                    -- e.g. "OCR misread G→Q (edit_dist=1)"
    merged_by    VARCHAR(200)  DEFAULT CURRENT_USER(),
    merged_at    TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- ============================================================
-- 24. PROJECT_MERGE_PROVENANCE - Flat audit view: every source code → its canonical target,
-- with project names, merge reason, and current line count.
-- ============================================================
CREATE OR REPLACE VIEW PROJECT_MERGE_PROVENANCE AS
SELECT
    tgt.PROJECT_CODE                            AS CANONICAL_CODE,
    tgt.PROJECT_NAME                            AS CANONICAL_NAME,
    tgt.IS_ACTIVE                               AS CANONICAL_ACTIVE,
    m.SOURCE_CODE                               AS SOURCE_CODE,
    src.PROJECT_NAME                            AS SOURCE_NAME,
    m.MERGE_REASON                              AS MERGE_REASON,
    m.MERGED_BY                                 AS MERGED_BY,
    m.MERGED_AT                                 AS MERGED_AT,
    COUNT(el.LINE_ID)                           AS LINES_AFFECTED
FROM PROJECT_CODE_MERGES m
JOIN CURATED_PROJECTS tgt ON tgt.PROJECT_CODE = m.TARGET_CODE
LEFT JOIN CURATED_PROJECTS src ON src.PROJECT_CODE = m.SOURCE_CODE
LEFT JOIN EXTRACTED_LINES el ON el.project_code = tgt.PROJECT_CODE
GROUP BY
    tgt.PROJECT_CODE, tgt.PROJECT_NAME, tgt.IS_ACTIVE,
    m.SOURCE_CODE, src.PROJECT_NAME,
    m.MERGE_REASON, m.MERGED_BY, m.MERGED_AT
ORDER BY tgt.PROJECT_CODE, m.MERGED_AT;

-- ============================================================
-- 25. APPLY_PROJECT_MERGES - Hard-write all active merge mappings to EXTRACTED_LINES.
-- Call this after creating or updating merges to propagate corrections to the raw data.
-- Safe to call repeatedly (idempotent: already-merged rows are no-ops).
-- ============================================================
CREATE OR REPLACE PROCEDURE APPLY_PROJECT_MERGES()
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
DECLARE
    rows_updated INTEGER;
BEGIN
    UPDATE EXTRACTED_LINES el
    SET
        project_code = m.target_code,
        project      = cp.project_name
    FROM PROJECT_CODE_MERGES m
    JOIN CURATED_PROJECTS cp ON cp.project_code = m.target_code
    WHERE el.project_code = m.source_code;

    rows_updated := SQLROWCOUNT;

    -- Mark merged source codes as inactive in the curated master
    UPDATE CURATED_PROJECTS
    SET is_active = FALSE,
        curation_note = COALESCE(curation_note, '') || ' | Merged into ' || m.target_code
    FROM PROJECT_CODE_MERGES m
    WHERE CURATED_PROJECTS.project_code = m.source_code
      AND CURATED_PROJECTS.is_active = TRUE;

    RETURN 'SUCCESS: Updated ' || :rows_updated::VARCHAR || ' extracted line(s) via project code merges';
EXCEPTION
    WHEN OTHER THEN
        RETURN 'ERROR: ' || SQLERRM;
END;
$$;