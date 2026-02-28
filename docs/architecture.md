# Architecture

## Data Flow

```mermaid
flowchart TD
    A([Analyst<br>Next.js Browser]) -->|"Upload file"| B["Next.js API Route<br>/api/documents POST<br>(Node.js · snowflake-sdk)"]
    B -->|"PUT @DOCUMENTS_STAGE_SSE"| SF_STAGE[("Snowflake<br>SSE-Encrypted Stage<br>DOCUMENTS_STAGE_SSE")]

    A -->|"Click Extract / Extract All"| C["Next.js API Route<br>/api/extraction/[id] POST"]
    C -->|"CALL EXTRACT_DOCUMENT_MULTIMODAL(doc_id)"| PROC

    subgraph Snowflake ["Snowflake RECONCILIATION.PUBLIC"]
        SF_STAGE
        PROC["EXTRACT_DOCUMENT_MULTIMODAL<br>(or EXTRACT_ALL_MULTIMODAL)<br>Snowflake Stored Procedure"]

        PROC -->|"doc_type = TIMESHEET<br>TO_FILE() — multimodal image"| CORTEX_IMG["SNOWFLAKE.CORTEX.COMPLETE<br>claude-3-5-sonnet<br>image + extraction prompt → JSON"]

        PROC -->|"doc_type = SUBSUB_INVOICE<br>PDF not supported by TO_FILE"| PARSE["SNOWFLAKE.CORTEX.PARSE_DOCUMENT<br>PDF → extracted text"]
        PARSE -->|"text + invoice prompt"| CORTEX_TXT["SNOWFLAKE.CORTEX.COMPLETE<br>claude-3-5-sonnet<br>text + invoice prompt → JSON"]

        CORTEX_IMG --> EL[("EXTRACTED_LINES\nworker · work_date · project\nproject_code · hours · confidence")]
        CORTEX_TXT --> EL

        EL --> SYNC["SYNC_CURATED_MASTER<br>auto-populate project + worker master"]
        SYNC --> CP[("CURATED_PROJECTS")]
        SYNC --> CW[("CURATED_WORKERS")]

        CP --> SUSP["PROJECT_CODE_SUSPECTS\nEDITDISTANCE ≤ 3"]
        CW --> WSUSP["WORKER_NAME_SUSPECTS\nEDITDISTANCE ≤ 3"]

        EL --> TL["TRUSTED_LEDGER view\napproved + corrected lines\nproject_code resolved via merges"]
        AL[("APPROVED_LINES\ndecision · corrections")] --> TL
        PCM[("PROJECT_CODE_MERGES\nsource → target")] --> TL

        TL --> RS[("RECON_SUMMARY\nmonthly hours · variance")]
    end

    SUSP -->|"suspects list"| MD_PAGE["Master Data Page\nConfirm codes · Create merges\nApply corrections"]
    WSUSP --> MD_PAGE
    MD_PAGE -->|"PATCH /api/master-data/projects"| CP
    MD_PAGE -->|"POST /api/master-data/merges/apply\n→ APPLY_PROJECT_MERGES()"| EL
    MD_PAGE --> PCM

    EL -->|"GET /api/ground-truth"| GT_PAGE["Ground Truth Page\nTimesheet docs only\nZoom/pan viewer · hours grid\nAI vs GT comparison inline"]
    GT_PAGE -->|"PUT /api/ground-truth/[id]"| CGT[("CURATED_GROUND_TRUTH\nanalyst-verified hours")]

    EL -->|"GET /api/approvals"| APPR["Approvals Page\nAPPROVE · REJECT · CORRECT\nper extracted line"]
    APPR -->|"POST /api/approvals/[id]"| AL

    TL -->|"GET /api/reconciliation"| RECON["Reconciliation Page\nMonthly worker summary\nTimesheet vs GT vs Invoice\nVariance check"]
    CGT --> RECON
    RS --> RECON

    style CORTEX_IMG fill:#4A90D9,color:#fff
    style CORTEX_TXT fill:#4A90D9,color:#fff
    style PARSE fill:#29B5E8,color:#fff
    style PROC fill:#29B5E8,color:#fff
    style TL fill:#2ECC71,color:#fff
    style CP fill:#8E44AD,color:#fff
    style CW fill:#8E44AD,color:#fff
    style PCM fill:#6C3483,color:#fff
    style CGT fill:#6C3483,color:#fff
    style AL fill:#6C3483,color:#fff
```

---

## How LLM Calls Work

There are **no Python agents** in this system. All AI extraction happens inside Snowflake via stored procedures that call `SNOWFLAKE.CORTEX.COMPLETE` (Claude 3.5 Sonnet). The Next.js frontend triggers extraction by calling these stored procedures directly through the Snowflake SDK.

### Timesheets (image files)

The stored procedure sends the raw image directly to Claude 3.5 Sonnet via `SNOWFLAKE.CORTEX.COMPLETE` with a multimodal prompt:

```sql
-- EXTRACT_DOCUMENT_MULTIMODAL — timesheet path
SELECT SNOWFLAKE.CORTEX.COMPLETE(
    'claude-3-5-sonnet',
    [{'role':'user','content':[
        {'type':'text',  'text': :timesheet_prompt},
        {'type':'image', 'source_media_type':'image/jpeg',
         'source': TO_FILE('@DOCUMENTS_STAGE_SSE', :filename)}
    ]}]
) INTO :llm_response;
```

The prompt instructs Claude to capture every project row per day, extract the alphanumeric project code (e.g. `006GI00000OBhiL`), return hours as decimals and dates as `YYYY-MM-DD`, and score confidence per field.

### Subcontract Invoices (PDF files)

`CORTEX.COMPLETE` does not support PDF via `TO_FILE`. The procedure falls back to a two-step path:

```sql
-- Step 1: Extract text from PDF
SELECT SNOWFLAKE.CORTEX.PARSE_DOCUMENT(
    '@DOCUMENTS_STAGE_SSE', :filename,
    {'mode': 'LAYOUT'}
):content::STRING INTO :pdf_text;

-- Step 2: Send text + invoice prompt to Claude
SELECT SNOWFLAKE.CORTEX.COMPLETE(
    'claude-3-5-sonnet',
    :invoice_prompt || :pdf_text
) INTO :llm_response;
```

The invoice prompt asks Claude to extract: worker name, total hours, and the last day of the billing month as `work_date`.

---

## Master Data Curation

After each extraction run, `SYNC_CURATED_MASTER` auto-populates `CURATED_PROJECTS` and `CURATED_WORKERS` with any newly seen codes and worker names. The `PROJECT_CODE_SUSPECTS` and `WORKER_NAME_SUSPECTS` views flag entries within edit-distance 3 of an existing confirmed master record (OCR misreads like `006QI` → `006GI`).

Analysts resolve these in the **Master Data → Merges** tab by creating `PROJECT_CODE_MERGES` records, then clicking **Apply Merges** to call `APPLY_PROJECT_MERGES()` which hard-writes corrections back to `EXTRACTED_LINES`. The `TRUSTED_LEDGER` view also resolves codes through the merge table as a belt-and-suspenders fallback.

---

## Trusted Ledger

`TRUSTED_LEDGER` is a view that joins `EXTRACTED_LINES` with `APPROVED_LINES`, applying corrections inline and resolving project codes through the merge table:

```sql
SELECT
    e.doc_id,
    COALESCE(a.corrected_hours,   e.hours)      AS hours,
    COALESCE(a.corrected_date,    e.work_date)  AS work_date,
    COALESCE(a.corrected_project, e.project)    AS project,
    COALESCE(m.target_code,       e.project_code) AS project_code,
    ...
FROM EXTRACTED_LINES e
INNER JOIN APPROVED_LINES a ON e.line_id = a.line_id
LEFT  JOIN PROJECT_CODE_MERGES m ON e.project_code = m.source_code
WHERE a.decision IN ('APPROVED', 'CORRECTED');
```

Only lines explicitly approved or corrected by an analyst appear here. This is the financial system of record.
