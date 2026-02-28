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

-- 7. GROUND_TRUTH_LINES - Financial analyst-entered correct data
CREATE TABLE IF NOT EXISTS GROUND_TRUTH_LINES (
    gt_line_id VARCHAR(100) PRIMARY KEY DEFAULT UUID_STRING(),
    doc_id VARCHAR(100) NOT NULL REFERENCES RAW_DOCUMENTS(doc_id),
    worker VARCHAR(200),
    work_date DATE,
    project VARCHAR(200),
    hours DECIMAL(5,2),
    notes TEXT,
    entered_by VARCHAR(200) DEFAULT CURRENT_USER(),
    entered_ts TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

-- 8. LEDGER_APPROVALS - Analyst approve/reject/correct decisions per extracted line
CREATE TABLE IF NOT EXISTS LEDGER_APPROVALS (
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
    FROM GROUND_TRUTH_LINES
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
CREATE OR REPLACE VIEW TRUSTED_LEDGER AS
SELECT
    e.line_id,
    e.doc_id,
    COALESCE(a.corrected_worker, e.worker) AS worker,
    COALESCE(a.corrected_date, e.work_date) AS work_date,
    COALESCE(a.corrected_project, e.project) AS project,
    COALESCE(a.corrected_hours, e.hours) AS hours,
    a.decision AS approval_status,
    a.reviewer,
    a.reviewed_ts,
    e.extraction_confidence,
    e.raw_text_snippet
FROM EXTRACTED_LINES e
INNER JOIN LEDGER_APPROVALS a ON e.line_id = a.line_id
WHERE a.decision IN ('APPROVED', 'CORRECTED');

-- 11. Create stored procedure to run OCR on staged documents
CREATE OR REPLACE PROCEDURE PROCESS_DOCUMENT_OCR(
    P_DOC_ID VARCHAR,
    P_DOC_TYPE VARCHAR,
    P_FILE_PATH VARCHAR
)
RETURNS VARCHAR
LANGUAGE SQL
AS
$$
DECLARE
    ocr_result TEXT;
BEGIN
    -- Run Cortex PARSE_DOCUMENT for OCR
    SELECT SNOWFLAKE.CORTEX.PARSE_DOCUMENT(
        BUILD_SCOPED_FILE_URL(:P_FILE_PATH),
        {'mode': 'OCR'}
    ):content::TEXT INTO ocr_result;
    
    -- Update with OCR results
    UPDATE RAW_DOCUMENTS 
    SET ocr_text = :ocr_result,
        ocr_status = 'COMPLETED'
    WHERE doc_id = :P_DOC_ID;
    
    RETURN 'SUCCESS: OCR completed for ' || :P_DOC_ID;
EXCEPTION
    WHEN OTHER THEN
        UPDATE RAW_DOCUMENTS 
        SET ocr_status = 'FAILED'
        WHERE doc_id = :P_DOC_ID;
        RETURN 'ERROR: ' || SQLERRM;
END;
$$;

-- 8. Create procedure to batch process all pending documents in stage
CREATE OR REPLACE PROCEDURE PROCESS_ALL_STAGED_DOCUMENTS()
RETURNS TABLE (doc_id VARCHAR, status VARCHAR)
LANGUAGE SQL
AS
$$
DECLARE
    result_cursor CURSOR FOR
        SELECT 
            REGEXP_REPLACE(RELATIVE_PATH, '\\.[^.]+$', '') AS doc_id,
            CASE 
                WHEN RELATIVE_PATH ILIKE '%timesheet%' THEN 'TIMESHEET'
                WHEN RELATIVE_PATH ILIKE '%subsub%' THEN 'SUBSUB_INVOICE'
                WHEN RELATIVE_PATH ILIKE '%invoice%' THEN 'MY_INVOICE'
                ELSE 'TIMESHEET'
            END AS doc_type,
            '@DOCUMENTS_STAGE/' || RELATIVE_PATH AS file_path
        FROM DIRECTORY(@DOCUMENTS_STAGE)
        WHERE RELATIVE_PATH NOT IN (SELECT REGEXP_REPLACE(file_path, '@DOCUMENTS_STAGE/', '') FROM RAW_DOCUMENTS);
BEGIN
    CREATE OR REPLACE TEMPORARY TABLE process_results (doc_id VARCHAR, status VARCHAR);
    
    FOR rec IN result_cursor DO
        LET result VARCHAR := (CALL PROCESS_DOCUMENT_OCR(rec.doc_id, rec.doc_type, rec.file_path));
        INSERT INTO process_results VALUES (rec.doc_id, result);
    END FOR;
    
    RETURN TABLE(SELECT * FROM process_results);
END;
$$;

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
    extraction_prompt TEXT;
BEGIN
    -- Derive filename from file_path (e.g. '@...STAGE_UNENC/9-13-2025.jpg' -> '9-13-2025.jpg')
    filename := REGEXP_REPLACE(:P_FILE_PATH, '^.*/', '');

    extraction_prompt := 'You are a document extraction specialist. Extract structured timesheet data from this image.

Return ONLY valid JSON (no markdown fences) in this exact format:
{
  "lines": [
    {
      "worker": "Full Name",
      "work_date": "YYYY-MM-DD",
      "project": "Project Name",
      "project_code": "006GI00000OBhiL",
      "hours": 8.0,
      "extraction_confidence": 0.95,
      "raw_text_snippet": "brief description of source row"
    }
  ]
}

Rules:
- CRITICAL: List ALL project rows visible in the timesheet. Timesheets typically have 2-3 distinct project rows per day. Carefully scan every row even if project names look similar — each row is a separate entry and must be captured.
- Each unique project row for each day must be its own JSON object. Do NOT merge or skip rows.
- Extract the alphanumeric source-system code (e.g. 006GI00000OBhiL, 006GI00000P4aPt, 006Q0000000BRIL) that appears as a prefix or identifier on each project row into the "project_code" field. If no code is visible, set project_code to null.
- Use exact project names as shown in the "project" field (without the code prefix).
- Include every day/project combination visible, even if hours are 0
- Dates must be YYYY-MM-DD format
- Hours must be decimal numbers
- extraction_confidence should reflect how clearly the value is readable (0.0-1.0)';

    -- Call Claude 3.5 Sonnet multimodal with the image file
    SELECT SNOWFLAKE.CORTEX.COMPLETE(
        'claude-3-5-sonnet',
        :extraction_prompt,
        TO_FILE('@DOCUMENTS_STAGE', :filename)
    ) INTO llm_response;

    -- Strip markdown code fences if present
    llm_response := REGEXP_REPLACE(:llm_response, '^```(json)?\\s*', '');
    llm_response := REGEXP_REPLACE(:llm_response, '\\s*```$', '');

    -- Parse the JSON response
    parsed := PARSE_JSON(:llm_response);
    lines_array := :parsed:lines;
    line_count := ARRAY_SIZE(:lines_array);

    -- Delete old data for this doc (idempotent re-extraction)
    DELETE FROM LEDGER_APPROVALS WHERE doc_id = :P_DOC_ID;
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
             extraction_confidence, raw_text_snippet)
        VALUES
            (:line_id_val, :P_DOC_ID, :worker_val, :work_date_val::DATE, :project_val,
             :project_code_val, :hours_val, :confidence_val, :snippet_val);

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
    extraction_prompt TEXT;
    res RESULTSET;
BEGIN
    extraction_prompt := 'You are a document extraction specialist. Extract structured timesheet data from this image.

Return ONLY valid JSON (no markdown fences) in this exact format:
{
  "lines": [
    {
      "worker": "Full Name",
      "work_date": "YYYY-MM-DD",
      "project": "Project Name",
      "project_code": "006GI00000OBhiL",
      "hours": 8.0,
      "extraction_confidence": 0.95,
      "raw_text_snippet": "brief description of source row"
    }
  ]
}

Rules:
- CRITICAL: List ALL project rows visible in the timesheet. Timesheets typically have 2-3 distinct project rows per day. Carefully scan every row even if project names look similar — each row is a separate entry and must be captured.
- Each unique project row for each day must be its own JSON object. Do NOT merge or skip rows.
- Extract the alphanumeric source-system code (e.g. 006GI00000OBhiL, 006GI00000P4aPt, 006Q0000000BRIL) that appears as a prefix or identifier on each project row into the "project_code" field. If no code is visible, set project_code to null.
- Use exact project names as shown in the "project" field (without the code prefix).
- Include every day/project combination visible, even if hours are 0
- Dates must be YYYY-MM-DD format
- Hours must be decimal numbers
- extraction_confidence should reflect how clearly the value is readable (0.0-1.0)';

    -- Clean out old extracted data (idempotent re-extraction)
    DELETE FROM LEDGER_APPROVALS  WHERE doc_id IN (SELECT doc_id FROM RAW_DOCUMENTS);
    DELETE FROM VALIDATION_RESULTS WHERE doc_id IN (SELECT doc_id FROM RAW_DOCUMENTS);
    DELETE FROM EXTRACTED_LINES    WHERE doc_id IN (SELECT doc_id FROM RAW_DOCUMENTS);

    -- Single set-based INSERT: Snowflake parallelises CORTEX.COMPLETE across rows
    INSERT INTO EXTRACTED_LINES
        (line_id, doc_id, worker, work_date, project, project_code, hours,
         extraction_confidence, raw_text_snippet)
    WITH raw_responses AS (
        SELECT
            d.doc_id,
            REGEXP_REPLACE(d.file_path, '^.*/', '') AS filename,
            SNOWFLAKE.CORTEX.COMPLETE(
                'claude-3-5-sonnet',
                :extraction_prompt,
                TO_FILE('@DOCUMENTS_STAGE', REGEXP_REPLACE(d.file_path, '^.*/', ''))
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
        line_obj:raw_text_snippet::VARCHAR           AS raw_text_snippet
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