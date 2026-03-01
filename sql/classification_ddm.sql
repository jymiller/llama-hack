-- ============================================================
-- RECONCILIATION.PUBLIC
-- Data Classification, Tagging & Dynamic Data Masking (DDM)
-- ============================================================
-- Overview
-- --------
-- Section 1  : Roles (RECON_ANALYST, RECON_VIEWER)
-- Section 2  : Custom tags (5 semantic tags)
-- Section 3  : Masking policies (STRING, NUMBER, VARIANT)
-- Section 4  : Tag → Policy bindings (tag-based DDM)
-- Section 5  : Apply tags to every sensitive column across all tables
-- Section 6  : Snowflake auto-classification (SYSTEM$CLASSIFY) dry-run + apply
-- Section 7  : Verification queries
--
-- Role hierarchy for masking decisions:
--   ACCOUNTADMIN / SYSADMIN  →  see everything (no masking)
--   RECON_ANALYST             →  see everything (data steward / financial lead)
--   RECON_VIEWER              →  sees nicknames, redacted text, NULL financials
--   (any other role)          →  same as RECON_VIEWER
--
-- Run as ACCOUNTADMIN or a role with CREATE TAG, CREATE MASKING POLICY,
-- APPLY MASKING POLICY, and APPLY TAG privileges.
-- ============================================================

USE DATABASE RECONCILIATION;
USE SCHEMA PUBLIC;


-- ============================================================
-- 1. ROLES
-- ============================================================

CREATE ROLE IF NOT EXISTS RECON_ANALYST
    COMMENT = 'Full visibility: financial leads and data stewards';

CREATE ROLE IF NOT EXISTS RECON_VIEWER
    COMMENT = 'Read-only with masked PII/sensitive/financial columns';

-- Hierarchy: ANALYST inherits VIEWER privileges
GRANT ROLE RECON_VIEWER TO ROLE RECON_ANALYST;

-- Database / schema access
GRANT USAGE ON DATABASE RECONCILIATION TO ROLE RECON_ANALYST;
GRANT USAGE ON DATABASE RECONCILIATION TO ROLE RECON_VIEWER;
GRANT USAGE ON SCHEMA   RECONCILIATION.PUBLIC TO ROLE RECON_ANALYST;
GRANT USAGE ON SCHEMA   RECONCILIATION.PUBLIC TO ROLE RECON_VIEWER;

-- Table / view SELECT
GRANT SELECT ON ALL TABLES IN SCHEMA RECONCILIATION.PUBLIC TO ROLE RECON_ANALYST;
GRANT SELECT ON ALL TABLES IN SCHEMA RECONCILIATION.PUBLIC TO ROLE RECON_VIEWER;
GRANT SELECT ON ALL VIEWS  IN SCHEMA RECONCILIATION.PUBLIC TO ROLE RECON_ANALYST;
GRANT SELECT ON ALL VIEWS  IN SCHEMA RECONCILIATION.PUBLIC TO ROLE RECON_VIEWER;

-- Future tables / views (keeps grants current after DDL changes)
GRANT SELECT ON FUTURE TABLES IN SCHEMA RECONCILIATION.PUBLIC TO ROLE RECON_ANALYST;
GRANT SELECT ON FUTURE TABLES IN SCHEMA RECONCILIATION.PUBLIC TO ROLE RECON_VIEWER;
GRANT SELECT ON FUTURE VIEWS  IN SCHEMA RECONCILIATION.PUBLIC TO ROLE RECON_ANALYST;
GRANT SELECT ON FUTURE VIEWS  IN SCHEMA RECONCILIATION.PUBLIC TO ROLE RECON_VIEWER;

-- Warehouse (adjust name to match your environment)
GRANT USAGE ON WAREHOUSE DEFAULT_WH TO ROLE RECON_ANALYST;
GRANT USAGE ON WAREHOUSE DEFAULT_WH TO ROLE RECON_VIEWER;


-- ============================================================
-- 2. CUSTOM TAGS
-- ============================================================
-- Five semantic tags drive tag-based DDM.
-- Values are informational metadata; masking is controlled by
-- which tag a column carries, not the tag's value.

CREATE OR REPLACE TAG PII_WORKER_NAME
    COMMENT = 'Real person display name (worker, reviewer, entered_by) — PII';

CREATE OR REPLACE TAG SENSITIVE_PROJECT_NAME
    COMMENT = 'Real client or project name — commercially confidential';

CREATE OR REPLACE TAG SENSITIVE_PROJECT_CODE
    COMMENT = 'Salesforce opportunity code — quasi-identifier';

CREATE OR REPLACE TAG FINANCIAL_AMOUNT
    COMMENT = 'Monetary amount (cost, invoice, variance) — finance-restricted';

CREATE OR REPLACE TAG RAW_DOCUMENT_TEXT
    COMMENT = 'Raw OCR / LLM output or JSON that may embed PII or project names';


-- ============================================================
-- 3. MASKING POLICIES
-- ============================================================

-- ── 3a. PII_WORKER_NAME  (STRING columns) ──────────────────
-- Privileged roles see the real name.
-- RECON_VIEWER gets the worker's nickname from CURATED_WORKERS
-- if one is set; otherwise falls back to "First I." format.
CREATE OR REPLACE MASKING POLICY MASK_WORKER_NAME
    AS (val STRING) RETURNS STRING ->
    CASE
        WHEN IS_ROLE_IN_SESSION('ACCOUNTADMIN') THEN val
        WHEN IS_ROLE_IN_SESSION('SYSADMIN')     THEN val
        WHEN IS_ROLE_IN_SESSION('RECON_ANALYST') THEN val
        ELSE COALESCE(
            -- Prefer curated nickname
            (SELECT nickname
             FROM   CURATED_WORKERS
             WHERE  worker_key = LOWER(TRIM(val))
               AND  nickname IS NOT NULL
             LIMIT  1),
            -- Fallback: "John D."
            CASE
                WHEN val IS NULL                  THEN NULL
                WHEN TRIM(val) ILIKE '% %'        THEN
                    TRIM(SPLIT_PART(TRIM(val), ' ', 1)) || ' '
                    || UPPER(SUBSTR(TRIM(SPLIT_PART(TRIM(val), ' ', 2)), 1, 1)) || '.'
                ELSE UPPER(SUBSTR(TRIM(val), 1, 1)) || '***'
            END
        )
    END
    COMMENT = 'Returns nickname from CURATED_WORKERS, else "First I." abbreviation';


-- ── 3b. SENSITIVE_PROJECT_NAME  (STRING columns) ───────────
-- Privileged roles see the real project/client name.
-- RECON_VIEWER gets the curated nickname; if none, falls back
-- to the project_code; if not in master, shows first word + "…"
CREATE OR REPLACE MASKING POLICY MASK_PROJECT_NAME
    AS (val STRING) RETURNS STRING ->
    CASE
        WHEN IS_ROLE_IN_SESSION('ACCOUNTADMIN')  THEN val
        WHEN IS_ROLE_IN_SESSION('SYSADMIN')      THEN val
        WHEN IS_ROLE_IN_SESSION('RECON_ANALYST') THEN val
        ELSE COALESCE(
            -- Prefer curated nickname, then project_code as safe alias
            (SELECT COALESCE(nickname, project_code)
             FROM   CURATED_PROJECTS
             WHERE  project_name = val
               AND  (nickname IS NOT NULL OR project_code IS NOT NULL)
             LIMIT  1),
            -- Fallback: first word + ellipsis
            CASE
                WHEN val IS NULL THEN NULL
                ELSE SPLIT_PART(TRIM(val), ' ', 1) || '…'
            END
        )
    END
    COMMENT = 'Returns nickname or project_code from CURATED_PROJECTS, else truncates';


-- ── 3c. SENSITIVE_PROJECT_CODE  (STRING columns) ───────────
-- Salesforce 15-char opportunity IDs like "006GI00000P4aPt".
-- Analysts see the full code; viewers see "006GI*********".
CREATE OR REPLACE MASKING POLICY MASK_PROJECT_CODE
    AS (val STRING) RETURNS STRING ->
    CASE
        WHEN IS_ROLE_IN_SESSION('ACCOUNTADMIN')  THEN val
        WHEN IS_ROLE_IN_SESSION('SYSADMIN')      THEN val
        WHEN IS_ROLE_IN_SESSION('RECON_ANALYST') THEN val
        -- RECON_VIEWER: reveal prefix only
        ELSE CASE
            WHEN val IS NULL THEN NULL
            ELSE SUBSTR(val, 1, 5)
                 || REPEAT('*', GREATEST(LENGTH(val) - 5, 0))
        END
    END
    COMMENT = 'Reveals first 5 chars of project code; remainder masked for RECON_VIEWER';


-- ── 3d. FINANCIAL_AMOUNT  (NUMBER columns) ─────────────────
-- Financial amounts (cost, invoice totals, variances) return NULL
-- for any role that is not RECON_ANALYST or higher.
CREATE OR REPLACE MASKING POLICY MASK_FINANCIAL_AMOUNT
    AS (val NUMBER) RETURNS NUMBER ->
    CASE
        WHEN IS_ROLE_IN_SESSION('ACCOUNTADMIN')  THEN val
        WHEN IS_ROLE_IN_SESSION('SYSADMIN')      THEN val
        WHEN IS_ROLE_IN_SESSION('RECON_ANALYST') THEN val
        ELSE NULL
    END
    COMMENT = 'Returns NULL for non-analyst roles on monetary columns';


-- ── 3e. RAW_DOCUMENT_TEXT  (STRING / TEXT columns) ─────────
-- OCR dumps, LLM prompt outputs, notes, and raw snippets can
-- contain embedded PII or project names.  Viewers see a
-- standardised redaction notice.
CREATE OR REPLACE MASKING POLICY MASK_RAW_TEXT
    AS (val STRING) RETURNS STRING ->
    CASE
        WHEN IS_ROLE_IN_SESSION('ACCOUNTADMIN')  THEN val
        WHEN IS_ROLE_IN_SESSION('SYSADMIN')      THEN val
        WHEN IS_ROLE_IN_SESSION('RECON_ANALYST') THEN val
        ELSE '*** REDACTED — contact your data steward ***'
    END
    COMMENT = 'Redacts raw OCR / LLM text for non-analyst roles';


-- ── 3f. RAW_DOCUMENT_JSON  (VARIANT columns) ───────────────
-- raw_line_json in EXTRACTED_LINES is a VARIANT.
-- Masking policies for VARIANT must return VARIANT.
CREATE OR REPLACE MASKING POLICY MASK_RAW_JSON
    AS (val VARIANT) RETURNS VARIANT ->
    CASE
        WHEN IS_ROLE_IN_SESSION('ACCOUNTADMIN')  THEN val
        WHEN IS_ROLE_IN_SESSION('SYSADMIN')      THEN val
        WHEN IS_ROLE_IN_SESSION('RECON_ANALYST') THEN val
        ELSE TO_VARIANT('*** REDACTED ***')
    END
    COMMENT = 'Redacts VARIANT JSON payload for non-analyst roles';


-- ============================================================
-- 4. TAG → POLICY BINDINGS  (tag-based DDM)
-- ============================================================
-- Once a tag is bound to a policy, every column tagged with it
-- automatically gets the policy applied — no per-column ALTER needed
-- beyond the SET TAG statement in Section 5.

ALTER TAG PII_WORKER_NAME        SET MASKING POLICY MASK_WORKER_NAME;
ALTER TAG SENSITIVE_PROJECT_NAME SET MASKING POLICY MASK_PROJECT_NAME;
ALTER TAG SENSITIVE_PROJECT_CODE SET MASKING POLICY MASK_PROJECT_CODE;
ALTER TAG RAW_DOCUMENT_TEXT      SET MASKING POLICY MASK_RAW_TEXT;
ALTER TAG FINANCIAL_AMOUNT       SET MASKING POLICY MASK_FINANCIAL_AMOUNT;

-- raw_line_json (VARIANT) is tagged inline in Section 5 and gets
-- MASK_RAW_JSON applied directly (tag-based VARIANT masking requires
-- Enterprise edition; fallback to direct column policy is below).


-- ============================================================
-- 5. APPLY TAGS TO COLUMNS
-- ============================================================
-- Tag value is a human-readable description for governance catalogues.
-- The masking policy activates solely because the tag is bound to it.

-- ── EXTRACTED_LINES ────────────────────────────────────────
ALTER TABLE EXTRACTED_LINES
    ALTER COLUMN worker           SET TAG PII_WORKER_NAME        = 'AI-extracted worker display name';
ALTER TABLE EXTRACTED_LINES
    ALTER COLUMN project          SET TAG SENSITIVE_PROJECT_NAME  = 'AI-extracted client project name';
ALTER TABLE EXTRACTED_LINES
    ALTER COLUMN project_code     SET TAG SENSITIVE_PROJECT_CODE  = 'AI-extracted Salesforce opportunity code';
ALTER TABLE EXTRACTED_LINES
    ALTER COLUMN raw_text_snippet SET TAG RAW_DOCUMENT_TEXT       = 'Raw snippet from LLM extraction — may contain PII';

-- VARIANT column: direct policy (tag-based VARIANT may need ACCOUNTADMIN)
ALTER TABLE EXTRACTED_LINES
    ALTER COLUMN raw_line_json    SET MASKING POLICY MASK_RAW_JSON;


-- ── CURATED_WORKERS ────────────────────────────────────────
ALTER TABLE CURATED_WORKERS
    ALTER COLUMN worker_key   SET TAG PII_WORKER_NAME = 'Normalised (lower/trim) worker key — PII identifier';
ALTER TABLE CURATED_WORKERS
    ALTER COLUMN display_name SET TAG PII_WORKER_NAME = 'Canonical worker display name — PII';
-- nickname is intentionally unmasked: it IS the safe alias

-- ── CURATED_PROJECTS ───────────────────────────────────────
ALTER TABLE CURATED_PROJECTS
    ALTER COLUMN project_name SET TAG SENSITIVE_PROJECT_NAME = 'Canonical client/project name — confidential';
ALTER TABLE CURATED_PROJECTS
    ALTER COLUMN project_code SET TAG SENSITIVE_PROJECT_CODE = 'Master Salesforce opportunity code';
-- nickname is intentionally unmasked: it IS the safe alias

-- ── CURATED_GROUND_TRUTH ───────────────────────────────────
ALTER TABLE CURATED_GROUND_TRUTH
    ALTER COLUMN worker       SET TAG PII_WORKER_NAME       = 'Analyst-entered worker name — PII';
ALTER TABLE CURATED_GROUND_TRUTH
    ALTER COLUMN project      SET TAG SENSITIVE_PROJECT_NAME = 'Analyst-entered project name — confidential';
ALTER TABLE CURATED_GROUND_TRUTH
    ALTER COLUMN project_code SET TAG SENSITIVE_PROJECT_CODE = 'Analyst-entered Salesforce code';
ALTER TABLE CURATED_GROUND_TRUTH
    ALTER COLUMN entered_by   SET TAG PII_WORKER_NAME       = 'Analyst who entered the record — PII';
ALTER TABLE CURATED_GROUND_TRUTH
    ALTER COLUMN notes        SET TAG RAW_DOCUMENT_TEXT     = 'Free-text notes — may contain PII or project names';
ALTER TABLE CURATED_GROUND_TRUTH
    ALTER COLUMN curation_note SET TAG RAW_DOCUMENT_TEXT    = 'Free-text curation note — may contain sensitive info';

-- ── APPROVED_LINES ─────────────────────────────────────────
ALTER TABLE APPROVED_LINES
    ALTER COLUMN corrected_worker  SET TAG PII_WORKER_NAME       = 'Analyst-corrected worker name — PII';
ALTER TABLE APPROVED_LINES
    ALTER COLUMN corrected_project SET TAG SENSITIVE_PROJECT_NAME = 'Analyst-corrected project name — confidential';
ALTER TABLE APPROVED_LINES
    ALTER COLUMN reviewer          SET TAG PII_WORKER_NAME       = 'Reviewing analyst name — PII';
ALTER TABLE APPROVED_LINES
    ALTER COLUMN reason            SET TAG RAW_DOCUMENT_TEXT     = 'Free-text approval reason — may contain PII';

-- ── RAW_DOCUMENTS ──────────────────────────────────────────
ALTER TABLE RAW_DOCUMENTS
    ALTER COLUMN ocr_text SET TAG RAW_DOCUMENT_TEXT = 'Raw OCR dump — contains worker names and project text';
-- file_path can expose internal naming conventions; tag as quasi-identifier
ALTER TABLE RAW_DOCUMENTS
    ALTER COLUMN file_path SET TAG SENSITIVE_PROJECT_CODE = 'Stage path — may encode project/client in filename';

-- ── RECON_SUMMARY  (financial) ─────────────────────────────
ALTER TABLE RECON_SUMMARY
    ALTER COLUMN implied_cost          SET TAG FINANCIAL_AMOUNT = 'Computed labour cost — finance restricted';
ALTER TABLE RECON_SUMMARY
    ALTER COLUMN invoice_subsub_amount SET TAG FINANCIAL_AMOUNT = 'Subcontractor invoice total — finance restricted';
ALTER TABLE RECON_SUMMARY
    ALTER COLUMN invoice_my_amount     SET TAG FINANCIAL_AMOUNT = 'Our invoice total — finance restricted';
ALTER TABLE RECON_SUMMARY
    ALTER COLUMN variance_subsub       SET TAG FINANCIAL_AMOUNT = 'Subsub variance — finance restricted';
ALTER TABLE RECON_SUMMARY
    ALTER COLUMN variance_my           SET TAG FINANCIAL_AMOUNT = 'Our-invoice variance — finance restricted';

-- ── VALIDATION_RESULTS ─────────────────────────────────────
-- details and computed_value may echo back worker/project text
ALTER TABLE VALIDATION_RESULTS
    ALTER COLUMN details        SET TAG RAW_DOCUMENT_TEXT = 'Validation detail text — may echo PII';
ALTER TABLE VALIDATION_RESULTS
    ALTER COLUMN computed_value SET TAG RAW_DOCUMENT_TEXT = 'Computed validation value — may echo PII';


-- ============================================================
-- 6. SNOWFLAKE AUTO-CLASSIFICATION  (SYSTEM$CLASSIFY)
-- ============================================================
-- Snowflake's ML model samples column data and assigns system tags:
--   SNOWFLAKE.CORE.SEMANTIC_CATEGORY  (e.g. NAME, EMAIL, DATE_OF_BIRTH)
--   SNOWFLAKE.CORE.PRIVACY_CATEGORY   (e.g. IDENTIFIER, QUASI_IDENTIFIER)
--
-- These complement our custom tags. Run STEP A first (dry-run) to
-- review what Snowflake detects, then uncomment STEP B to apply.
--
-- Requires: PRIVACY_ADMIN privilege (or ACCOUNTADMIN).

-- ── STEP A: Dry-run — inspect JSON output, no tags applied ──
SELECT 'EXTRACTED_LINES'      AS tbl,
       SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.EXTRACTED_LINES',
                        {'auto_tag': false}) AS result;

SELECT 'CURATED_WORKERS'      AS tbl,
       SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.CURATED_WORKERS',
                        {'auto_tag': false}) AS result;

SELECT 'CURATED_PROJECTS'     AS tbl,
       SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.CURATED_PROJECTS',
                        {'auto_tag': false}) AS result;

SELECT 'CURATED_GROUND_TRUTH' AS tbl,
       SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.CURATED_GROUND_TRUTH',
                        {'auto_tag': false}) AS result;

SELECT 'APPROVED_LINES'       AS tbl,
       SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.APPROVED_LINES',
                        {'auto_tag': false}) AS result;

SELECT 'RAW_DOCUMENTS'        AS tbl,
       SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.RAW_DOCUMENTS',
                        {'auto_tag': false}) AS result;

SELECT 'RECON_SUMMARY'        AS tbl,
       SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.RECON_SUMMARY',
                        {'auto_tag': false}) AS result;

SELECT 'VALIDATION_RESULTS'   AS tbl,
       SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.VALIDATION_RESULTS',
                        {'auto_tag': false}) AS result;


-- ── STEP B: Apply SNOWFLAKE.CORE auto-tags ──────────────────
-- Uncomment each line after reviewing Step A output.
-- These Snowflake system tags are additive to our custom tags.
--
-- SELECT SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.EXTRACTED_LINES',      {'auto_tag': true});
-- SELECT SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.CURATED_WORKERS',      {'auto_tag': true});
-- SELECT SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.CURATED_PROJECTS',     {'auto_tag': true});
-- SELECT SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.CURATED_GROUND_TRUTH', {'auto_tag': true});
-- SELECT SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.APPROVED_LINES',       {'auto_tag': true});
-- SELECT SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.RAW_DOCUMENTS',        {'auto_tag': true});
-- SELECT SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.RECON_SUMMARY',        {'auto_tag': true});
-- SELECT SYSTEM$CLASSIFY('RECONCILIATION.PUBLIC.VALIDATION_RESULTS',   {'auto_tag': true});


-- ── (Optional) Schema-wide classification ───────────────────
-- Snowflake 8.x introduces SYSTEM$CLASSIFY_SCHEMA; if available:
-- SELECT SYSTEM$CLASSIFY_SCHEMA('RECONCILIATION.PUBLIC', {'auto_tag': false});


-- ── STEP C: (Optional) DDM on Snowflake auto-tags ───────────
-- After Step B you can also bind masking policies to the system
-- SEMANTIC_CATEGORY tag so every auto-detected NAME column is masked:
--
-- ALTER TAG SNOWFLAKE.CORE.SEMANTIC_CATEGORY
--     SET MASKING POLICY MASK_WORKER_NAME
--         FORCE;   -- 'NAME' value columns
--
-- Be careful: SNOWFLAKE.CORE tags apply across your entire account.
-- Scoping to a single schema requires conditional logic inside the policy.


-- ============================================================
-- 7. GRANT MASKING POLICY USAGE TO ROLES
-- ============================================================
-- Roles that own tables must be able to use the policies when
-- they query data (i.e. the masking framework needs this grant).

GRANT OWNERSHIP ON MASKING POLICY MASK_WORKER_NAME       TO ROLE ACCOUNTADMIN REVOKE CURRENT GRANTS;
GRANT OWNERSHIP ON MASKING POLICY MASK_PROJECT_NAME      TO ROLE ACCOUNTADMIN REVOKE CURRENT GRANTS;
GRANT OWNERSHIP ON MASKING POLICY MASK_PROJECT_CODE      TO ROLE ACCOUNTADMIN REVOKE CURRENT GRANTS;
GRANT OWNERSHIP ON MASKING POLICY MASK_FINANCIAL_AMOUNT  TO ROLE ACCOUNTADMIN REVOKE CURRENT GRANTS;
GRANT OWNERSHIP ON MASKING POLICY MASK_RAW_TEXT          TO ROLE ACCOUNTADMIN REVOKE CURRENT GRANTS;
GRANT OWNERSHIP ON MASKING POLICY MASK_RAW_JSON          TO ROLE ACCOUNTADMIN REVOKE CURRENT GRANTS;

-- Allow RECON_ANALYST to see masking policy definitions (optional)
GRANT APPLY MASKING POLICY ON ACCOUNT TO ROLE RECON_ANALYST;


-- ============================================================
-- 8. VERIFICATION QUERIES
-- ============================================================

-- 8a. All tagged columns across the schema
SELECT
    ref_entity_name        AS table_name,
    ref_column_name        AS column_name,
    tag_name,
    tag_value,
    policy_name
FROM TABLE(
    INFORMATION_SCHEMA.POLICY_REFERENCES(
        ref_entity_domain => 'TABLE',
        ref_entity_name   => 'RECONCILIATION.PUBLIC.EXTRACTED_LINES'
    )
)
ORDER BY table_name, column_name;

-- 8b. All masking policy references in the schema
SELECT
    policy_db,
    policy_schema,
    policy_name,
    policy_kind,
    ref_entity_name     AS table_name,
    ref_column_name     AS column_name,
    ref_column_data_type
FROM INFORMATION_SCHEMA.POLICY_REFERENCES
WHERE policy_db     = 'RECONCILIATION'
  AND policy_schema = 'PUBLIC'
ORDER BY ref_entity_name, ref_column_name;

-- 8c. Tag inventory — every tag assignment in the schema
SELECT *
FROM TABLE(
    RECONCILIATION.INFORMATION_SCHEMA.TAG_REFERENCES_ALL_COLUMNS(
        'RECONCILIATION.PUBLIC.EXTRACTED_LINES', 'TABLE'
    )
)
ORDER BY column_name;

-- 8d. Smoke-test masking — run as RECON_VIEWER, then RECON_ANALYST
-- Compare: VIEWER sees nicknames/redacted; ANALYST sees real values.
--
-- USE ROLE RECON_VIEWER;
-- SELECT worker, project, project_code, raw_text_snippet
-- FROM   EXTRACTED_LINES LIMIT 5;
--
-- USE ROLE RECON_ANALYST;
-- SELECT worker, project, project_code, raw_text_snippet
-- FROM   EXTRACTED_LINES LIMIT 5;
--
-- USE ROLE RECON_VIEWER;
-- SELECT implied_cost, invoice_subsub_amount FROM RECON_SUMMARY LIMIT 5;
-- -- expected: all NULLs
--
-- USE ROLE ACCOUNTADMIN;  -- restore
