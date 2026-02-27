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

-- 7. Create stored procedure to run OCR on staged documents
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
    -- Insert document record
    INSERT INTO RAW_DOCUMENTS (doc_id, doc_type, file_path, ocr_status)
    VALUES (:P_DOC_ID, :P_DOC_TYPE, :P_FILE_PATH, 'PENDING');
    
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

-- 9. View for easy monitoring of pipeline status
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
