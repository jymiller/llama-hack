# Dynamic Data Masking Incident: Circular Policy Reference

**Date:** February 28, 2026  
**Impact:** All tables with tagged columns became unqueryable  
**Resolution Time:** ~15 minutes  
**Root Cause:** Masking policies referenced lookup tables that were themselves masked by the same policies

---

## Executive Summary

An attempt to implement tag-based Dynamic Data Masking (DDM) in Snowflake broke the application by creating circular policy references. Masking policies contained subqueries that looked up values from reference tables (`CURATED_WORKERS`, `CURATED_PROJECTS`), but those same reference tables had tags applied that bound them to the masking policies. This created an infinite loop that Snowflake rejected at query time.

---

## What Was Attempted

The goal was to implement a comprehensive data classification and masking system:

1. **Create custom tags** to classify sensitive data:
   - `PII_WORKER_NAME` - Worker/person names
   - `SENSITIVE_PROJECT_NAME` - Client/project names  
   - `SENSITIVE_PROJECT_CODE` - Salesforce opportunity codes
   - `FINANCIAL_AMOUNT` - Monetary values
   - `RAW_DOCUMENT_TEXT` - OCR/LLM output text

2. **Create masking policies** that return safe values for non-privileged roles:
   - `MASK_WORKER_NAME` - Returns nickname from `CURATED_WORKERS` or "First I." format
   - `MASK_PROJECT_NAME` - Returns nickname from `CURATED_PROJECTS` or truncated name
   - `MASK_PROJECT_CODE` - Shows first 5 characters, masks remainder
   - `MASK_FINANCIAL_AMOUNT` - Returns NULL for non-analysts
   - `MASK_RAW_TEXT` - Returns redaction notice

3. **Bind tags to policies** using tag-based DDM (Snowflake Enterprise feature)

4. **Apply tags to all sensitive columns** across 8 tables

---

## What Went Wrong

### The Circular Reference Problem

The `MASK_WORKER_NAME` policy contained this subquery:

```sql
CREATE OR REPLACE MASKING POLICY MASK_WORKER_NAME
    AS (val STRING) RETURNS STRING ->
    CASE
        WHEN IS_ROLE_IN_SESSION('RECON_ANALYST') THEN val
        ELSE COALESCE(
            -- This subquery is the problem:
            (SELECT nickname
             FROM   CURATED_WORKERS
             WHERE  worker_key = LOWER(TRIM(val))  -- References CURATED_WORKERS.worker_key
             LIMIT  1),
            -- Fallback logic...
        )
    END;
```

But later in the script, `CURATED_WORKERS.worker_key` was tagged:

```sql
ALTER TABLE CURATED_WORKERS
    ALTER COLUMN worker_key SET TAG PII_WORKER_NAME = '...';
```

Since `PII_WORKER_NAME` was bound to `MASK_WORKER_NAME`:

```sql
ALTER TAG PII_WORKER_NAME SET MASKING POLICY MASK_WORKER_NAME;
```

This created a circular dependency:

```
Query EXTRACTED_LINES.worker
  → Triggers MASK_WORKER_NAME policy
    → Policy executes SELECT from CURATED_WORKERS.worker_key
      → CURATED_WORKERS.worker_key has PII_WORKER_NAME tag
        → Triggers MASK_WORKER_NAME policy
          → Infinite loop detected → ERROR
```

The same pattern existed for `MASK_PROJECT_NAME` → `CURATED_PROJECTS`.

### The Error Message

```
SQL compilation error: Policy body contains a UDF or Select statement 
that refers to a column attached to another Policy.
```

This error appeared when querying ANY table that had columns tagged with `PII_WORKER_NAME` or `SENSITIVE_PROJECT_NAME`.

---

## Affected Objects

| Table | Columns Tagged | Result |
|-------|---------------|--------|
| `EXTRACTED_LINES` | worker, project, project_code, raw_text_snippet | Unqueryable |
| `CURATED_WORKERS` | worker_key, display_name | Unqueryable |
| `CURATED_PROJECTS` | project_name, project_code | Unqueryable |
| `CURATED_GROUND_TRUTH` | worker, project, project_code, entered_by, notes | Unqueryable |
| `APPROVED_LINES` | corrected_worker, corrected_project, reviewer, reason | Unqueryable |
| `RAW_DOCUMENTS` | ocr_text, file_path | Unqueryable |
| `RECON_SUMMARY` | (financial columns only - no circular ref) | Queryable |
| `VALIDATION_RESULTS` | details, computed_value | Unqueryable |

---

## How to Diagnose

### 1. Check for masking policies

```sql
SHOW MASKING POLICIES IN DATABASE RECONCILIATION;
```

### 2. Check tag-to-policy bindings

```sql
SHOW TAGS IN DATABASE RECONCILIATION;
-- Look for tags that have masking policies bound to them
```

### 3. Check which columns are tagged

```sql
SELECT tag_name, object_name, column_name 
FROM TABLE(
    INFORMATION_SCHEMA.TAG_REFERENCES_ALL_COLUMNS(
        'RECONCILIATION.PUBLIC.CURATED_WORKERS', 'TABLE'
    )
);
```

### 4. Identify the circular reference

If a masking policy body references Table X, and Table X has columns tagged with a tag bound to that same policy, you have a circular reference.

---

## Recovery Steps

Execute in this exact order:

### Step 1: Unbind policies from tags

```sql
USE DATABASE RECONCILIATION;
USE SCHEMA PUBLIC;

ALTER TAG PII_WORKER_NAME        UNSET MASKING POLICY MASK_WORKER_NAME;
ALTER TAG SENSITIVE_PROJECT_NAME UNSET MASKING POLICY MASK_PROJECT_NAME;
ALTER TAG SENSITIVE_PROJECT_CODE UNSET MASKING POLICY MASK_PROJECT_CODE;
ALTER TAG RAW_DOCUMENT_TEXT      UNSET MASKING POLICY MASK_RAW_TEXT;
ALTER TAG FINANCIAL_AMOUNT       UNSET MASKING POLICY MASK_FINANCIAL_AMOUNT;
```

### Step 2: Remove direct column policies (if any)

```sql
-- VARIANT columns may have direct policy assignments
ALTER TABLE EXTRACTED_LINES ALTER COLUMN raw_line_json UNSET MASKING POLICY;
```

### Step 3: Drop masking policies

```sql
DROP MASKING POLICY IF EXISTS MASK_WORKER_NAME;
DROP MASKING POLICY IF EXISTS MASK_PROJECT_NAME;
DROP MASKING POLICY IF EXISTS MASK_PROJECT_CODE;
DROP MASKING POLICY IF EXISTS MASK_FINANCIAL_AMOUNT;
DROP MASKING POLICY IF EXISTS MASK_RAW_TEXT;
DROP MASKING POLICY IF EXISTS MASK_RAW_JSON;
```

### Step 4: Drop tags

```sql
DROP TAG IF EXISTS PII_WORKER_NAME;
DROP TAG IF EXISTS SENSITIVE_PROJECT_NAME;
DROP TAG IF EXISTS SENSITIVE_PROJECT_CODE;
DROP TAG IF EXISTS FINANCIAL_AMOUNT;
DROP TAG IF EXISTS RAW_DOCUMENT_TEXT;
```

### Step 5: Verify recovery

```sql
-- These should now work:
SELECT * FROM EXTRACTED_LINES LIMIT 1;
SELECT * FROM CURATED_WORKERS LIMIT 1;
SHOW MASKING POLICIES IN DATABASE RECONCILIATION;  -- Should return 0 rows
SHOW TAGS IN DATABASE RECONCILIATION;              -- Should return 0 rows
```

---

## How to Implement DDM Correctly

### Option A: Exclude lookup tables from tagging

The simplest fix: don't tag columns in tables that are referenced by masking policies.

```sql
-- Tag EXTRACTED_LINES.worker (this is fine)
ALTER TABLE EXTRACTED_LINES
    ALTER COLUMN worker SET TAG PII_WORKER_NAME = 'AI-extracted worker name';

-- Do NOT tag CURATED_WORKERS.worker_key (used in policy subquery)
-- Do NOT tag CURATED_WORKERS.display_name (lookup table)
```

### Option B: Use a separate unmasked view for lookups

Create a view that bypasses masking for policy lookups:

```sql
-- Create an unmasked view owned by a service role
CREATE OR REPLACE VIEW CURATED_WORKERS_UNMASKED AS
SELECT worker_key, nickname FROM CURATED_WORKERS;

-- Grant to a service role used by the policy
GRANT SELECT ON CURATED_WORKERS_UNMASKED TO ROLE DDM_SERVICE_ROLE;

-- Rewrite policy to use the unmasked view
CREATE OR REPLACE MASKING POLICY MASK_WORKER_NAME
    AS (val STRING) RETURNS STRING ->
    CASE
        WHEN IS_ROLE_IN_SESSION('RECON_ANALYST') THEN val
        ELSE COALESCE(
            (SELECT nickname
             FROM   CURATED_WORKERS_UNMASKED  -- Use unmasked view
             WHERE  worker_key = LOWER(TRIM(val))
             LIMIT  1),
            -- Fallback...
        )
    END;
```

### Option C: Hardcode lookup values in the policy

For small lookup tables, embed the mappings directly:

```sql
CREATE OR REPLACE MASKING POLICY MASK_WORKER_NAME
    AS (val STRING) RETURNS STRING ->
    CASE
        WHEN IS_ROLE_IN_SESSION('RECON_ANALYST') THEN val
        WHEN LOWER(TRIM(val)) = 'mike agrawal (v)' THEN 'CoolestMike'
        WHEN LOWER(TRIM(val)) = 'datavantage group llc' THEN 'COOLMIKECO'
        -- ... other mappings ...
        ELSE UPPER(SUBSTR(TRIM(val), 1, 1)) || '***'
    END;
```

This avoids subqueries entirely but requires policy updates when nicknames change.

---

## Key Lessons

1. **Masking policies with subqueries create implicit dependencies.** Any table referenced in a policy subquery cannot have columns masked by that same policy.

2. **Tag-based DDM is powerful but unforgiving.** When you bind a tag to a policy, EVERY column with that tag gets the policy. Plan your tag assignments carefully.

3. **Test DDM in a non-production environment first.** The circular reference error only appears at query time, not when creating the policies or tags.

4. **Document your policy dependencies.** Create a matrix showing which policies reference which tables, and ensure those tables are excluded from related tags.

5. **Keep lookup/reference tables simple.** Tables used for masking policy lookups should ideally contain only non-sensitive data (like nicknames, codes, mappings).

---

## References

- [Snowflake Dynamic Data Masking](https://docs.snowflake.com/en/user-guide/security-column-ddm-intro)
- [Tag-based Masking Policies](https://docs.snowflake.com/en/user-guide/tag-based-masking-policies)
- [SYSTEM$CLASSIFY for Auto-Classification](https://docs.snowflake.com/en/sql-reference/stored-procedures/system_classify)
