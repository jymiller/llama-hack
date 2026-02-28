# Timesheet Reconciliation System

A hackathon project that converts timesheet screenshots and invoice images into a trusted, validated financial ledger — automatically. Built on **Snowflake Cortex**, **CrewAI**, and **Streamlit**.

---

## The Problem

Subcontracting billing chains create a silent audit gap: the prime contractor holds timesheet screenshots, the agency holds invoices, and neither side has a structured system of record. Every month, someone manually compares images to spreadsheets, hoping nothing slipped through.

This system eliminates that gap by:
1. Extracting structured data directly from images using Claude vision (via Snowflake Cortex)
2. Validating extracted data against configurable rules
3. Letting analysts enter or review ground truth inline
4. Producing a trusted approved ledger as the source of truth for reconciliation

---

## Business Process Flow

```mermaid
flowchart TD
    A([Prime Contractor<br>Timesheet Screenshots]) --> C
    B([Agency Invoice<br>Images]) --> C

    C[Upload to<br>DOCUMENTS_STAGE_SSE<br><i>Snowflake Internal SSE Stage</i>]

    C --> D{Extraction Method}

    D -->|Primary<br>Multimodal| E["EXTRACT_DOCUMENT_MULTIMODAL<br>(Snowflake Stored Procedure)"]
    D -->|Legacy<br>OCR + AI| F["PROCESS_DOCUMENT_OCR<br>(Snowflake Cortex PARSE_DOCUMENT)"]

    E --> G["SNOWFLAKE.CORTEX.COMPLETE<br>claude-3-5-sonnet<br>with image input"]
    F --> H["CrewAI Extraction Agent<br>(OCR text → structured rows)"]

    G --> I[(RAW_DOCUMENTS<br>+ EXTRACTED_LINES<br>worker · date · project<br>hours · confidence)]
    H --> I

    %% ── Master Data (Curated) ──────────────────────────────
    I -->|"SYNC_CURATED_MASTER<br>(after each extraction)"| MD["Master Data Sync"]

    MD --> CP[("CURATED_PROJECTS ✦<br>project_code · project_name<br>confirmed · curation_source<br>curation_note")]
    MD --> CW[("CURATED_WORKERS ✦<br>worker_key · display_name<br>confirmed · curation_source<br>curation_note")]

    CP --> FS["PROJECT_CODE_SUSPECTS view<br>EDITDISTANCE ≤ 3 vs confirmed codes<br>flags likely OCR misreads"]
    CW --> WS["WORKER_NAME_SUSPECTS view<br>EDITDISTANCE ≤ 3 vs confirmed names"]

    FS --> MDPage["Master Data Page<br>Pending review queue<br>Fuzzy-match alerts<br>Confirm / Edit"]
    WS --> MDPage
    MDPage --> CP
    MDPage --> CW

    %% ── Validation ─────────────────────────────────────────
    I --> J["Automated Validation<br>(RUN_VALIDATION proc)"]
    J --> K{Validation Checks}
    K -->|Document-level| K1["✓ Worker identifiable<br>✓ Dates present<br>✓ Avg confidence ≥ 0.7<br>✓ Total hours ≤ 60/week"]
    K -->|Line-level| K2["✓ Date format YYYY-MM-DD<br>✓ Hours 0–24<br>✓ Required fields present"]
    K -->|Cross-artifact| K3["✓ Approved hrs × rate<br>≈ Invoice amount ±1%"]
    K1 & K2 & K3 --> L[(VALIDATION_RESULTS<br>PASS · FAIL · WARN)]

    %% ── Analyst Review ─────────────────────────────────────
    L --> M["Next.js App<br>(Analyst Review)"]

    M --> N["Ground Truth Entry<br>Weekly grid side-by-side<br>with timesheet image"]
    M --> O["Accuracy Comparison<br>Extracted vs Ground Truth<br>day-by-day diff"]
    M --> P["Approval Workflow<br>APPROVE · REJECT · CORRECT<br>per extracted line"]

    N --> Q[("CURATED_GROUND_TRUTH ✦<br>analyst-entered hours<br>+ curation_note")]
    P --> R[("APPROVED_LINES ✦<br>decision · corrected_*<br>reviewer")]

    Q --> S["EXTRACTION_ACCURACY view<br>Matched · Discrepancy<br>Missing · Extra"]
    R --> T["TRUSTED_LEDGER view<br>Approved + corrected lines<br>with corrections applied"]

    T --> U["Reconciliation Page<br>Monthly/Quarterly Summary"]
    U --> V[(RECON_SUMMARY<br>Approved hrs · Implied cost<br>Invoice amounts · Variances)]

    V --> W{Variance<br>Within ±1%?}
    W -->|Yes| X([✅ Reconciliation<br>Complete])
    W -->|No| Y([⚠️ Exception Report])

    style G fill:#4A90D9,color:#fff
    style E fill:#29B5E8,color:#fff
    style T fill:#2ECC71,color:#fff
    style Y fill:#E74C3C,color:#fff
    style X fill:#2ECC71,color:#fff
    style CP fill:#8E44AD,color:#fff
    style CW fill:#8E44AD,color:#fff
    style MD fill:#7D3C98,color:#fff
    style MDPage fill:#9B59B6,color:#fff
    style Q fill:#6C3483,color:#fff
    style R fill:#6C3483,color:#fff
```

> **✦ Curated tables** (`CURATED_*`, `APPROVED_LINES`) contain analyst-reviewed or auto-synced reference data with a `curation_source` and `curation_note` tracking how each record was created or updated.

---

## Technology Stack

| Layer | Technology | Role |
|---|---|---|
| **Data Store** | Snowflake (`RECONCILIATION.PUBLIC`) | Tables, views, stored procedures, stage |
| **AI Extraction** | Snowflake Cortex (`CORTEX.COMPLETE`) | Sends images to Claude 3.5 Sonnet for multimodal extraction |
| **OCR Fallback** | Snowflake Cortex (`CORTEX.PARSE_DOCUMENT`) | Text-only OCR when multimodal is unavailable |
| **Agent Orchestration** | CrewAI | Extraction, validation, and ground truth comparison agents |
| **Frontend** | Streamlit | 6-page analyst review app |
| **Language** | Python 3.11+ | All pipeline scripts and the web app |
| **Notifications** | Composio | Gmail exception alerts when variances exceed tolerance |

---

## How It Works

### Extraction (Two Paths)

#### Primary: Multimodal (Image → Claude)

The preferred path skips OCR entirely. A Snowflake stored procedure sends the raw image file to Claude 3.5 Sonnet via `SNOWFLAKE.CORTEX.COMPLETE`, asking for structured JSON back:

```sql
-- sql/setup.sql: EXTRACT_DOCUMENT_MULTIMODAL procedure
SELECT SNOWFLAKE.CORTEX.COMPLETE(
    'claude-3-5-sonnet',
    extraction_prompt,            -- JSON schema + rules
    TO_FILE('@DOCUMENTS_STAGE_SSE', filename)  -- raw image (SSE stage required)
) INTO llm_response;
```

The response is parsed from JSON and inserted directly into `EXTRACTED_LINES`. `EXTRACT_ALL_MULTIMODAL` runs this across all documents in a single set-based `INSERT`, letting Snowflake parallelize the Cortex calls automatically.

The extraction prompt instructs Claude to:
- Capture **every** project row per day (timesheets typically have 2–3 projects per day)
- Extract the source-system alphanumeric project code (e.g. `006GI00000OBhiL`) into `project_code`
- Return hours as decimals, dates as `YYYY-MM-DD`
- Score confidence per field based on image clarity

#### Legacy: OCR → CrewAI Agent

When multimodal is unavailable, `PROCESS_DOCUMENT_OCR` runs `SNOWFLAKE.CORTEX.PARSE_DOCUMENT` to get raw OCR text, which is then passed to the `ExtractionAgent` (in `agents/extraction_agent.py`) via CrewAI. The agent interprets the noisy OCR output and returns a typed `ExtractionResult` Pydantic model.

---

### Validation

`run_validation.py` (and the `ValidationAgent` in `agents/validation_agent.py`) applies three tiers of checks, writing results to `VALIDATION_RESULTS`:

**Document-level**
- `WORKER_IDENTIFIABLE` — at least one worker name is present
- `DATES_PRESENT` — at least one valid date extracted
- `TOTAL_HOURS_REASONABLE` — weekly total ≤ 60h (WARN if exceeded)
- `EXTRACTION_CONFIDENCE` — average confidence ≥ 0.7 (WARN if below)

**Line-level** (applied to each extracted row)
- `VALID_DATE_FORMAT` — date parses as `YYYY-MM-DD`
- `HOURS_IN_RANGE` — hours between 0 and 24
- `REQUIRED_FIELDS_PRESENT` — worker, work_date, and hours are non-null

**Cross-artifact** (reconciliation)
- `approved_hours × hourly_rate ≈ invoice_amount` within ±1% tolerance

---

### Analyst Review (Streamlit App)

`app.py` is a 6-page Streamlit application. Pages are navigated from the sidebar. All data reads and writes go through `run_query()` / `run_execute()`, which use a cached Snowflake connection loaded from `~/.snowflake/connections.toml` (connection name: `hack`).

| Page | Purpose |
|---|---|
| **Documents** | Upload images to Snowflake stage, trigger OCR, preview raw OCR text |
| **Extraction** | Re-extract individual docs via multimodal, view extracted lines and validation results, monitor pipeline status |
| **Ground Truth** | Side-by-side view of the original image + an editable weekly grid (Sat–Fri). Analyst enters or corrects hours per project per day. Saved to `CURATED_GROUND_TRUTH`. |
| **Master Data** | Curated project code and worker master lists. Unconfirmed entries (auto-populated after extraction) appear in a review queue. Fuzzy-match suspects (edit-distance ≤ 3 to a confirmed code) are highlighted with the `curation_note` explaining the likely misread. Calls `SYNC_CURATED_MASTER` on demand. |
| **Accuracy** | Color-coded day-level diff between AI-extracted and ground truth hours. Shows MATCH / DISCREPANCY / MISSING / EXTRA per row. |
| **Approvals** | Per-line APPROVE / REJECT / CORRECT decisions. Bulk approve available. Corrections capture replacement hours, date, and project. Results go into `APPROVED_LINES`. |
| **Reconciliation** | Monthly/quarterly aggregations from `TRUSTED_LEDGER`, variance warnings vs. `RECON_SUMMARY`. |

---

### Trusted Ledger

`TRUSTED_LEDGER` is a view that joins `EXTRACTED_LINES` with `APPROVED_LINES`, applying corrections inline:

```sql
SELECT
    COALESCE(a.corrected_hours,   e.hours)      AS hours,
    COALESCE(a.corrected_date,    e.work_date)  AS work_date,
    COALESCE(a.corrected_project, e.project)    AS project,
    ...
FROM EXTRACTED_LINES e
INNER JOIN APPROVED_LINES a ON e.line_id = a.line_id
WHERE a.decision IN ('APPROVED', 'CORRECTED');
```
```

Only lines explicitly approved or corrected by an analyst appear here. This becomes the financial system of record.

---

## Data Model

```
── RAW TIER ─────────────────────────────────────────────────────────────────

RAW_DOCUMENTS          EXTRACTED_LINES         VALIDATION_RESULTS
─────────────          ───────────────         ──────────────────
doc_id (PK)    ──┬──▶  line_id (PK)       ◀──  validation_id (PK)
doc_type            │   doc_id (FK)             doc_id (FK)
file_path           │   worker                  line_id (FK, nullable)
ocr_text            │   work_date               rule_name
ocr_status          │   project                 status (PASS/FAIL/WARN)
ingested_ts         │   project_code            details
                    │   hours
                    │   extraction_confidence
                    │   raw_text_snippet

── CURATED TIER ─────────────────────────────────────────────────────────────

CURATED_PROJECTS       CURATED_WORKERS         CURATED_GROUND_TRUTH
────────────────       ───────────────         ────────────────────
project_code (PK)      worker_key (PK)         gt_id (PK)
project_name           display_name            doc_id (FK)
confirmed              confirmed               worker
is_active              is_active               work_date
first_seen             first_seen              project
curation_source ──┐    curation_source ──┐     hours
curation_note     │    curation_note     │     entered_by
matched_from_code │                      │     curation_note
                  │                      │
   auto_extracted ┤    auto_extracted ───┤  (new codes/workers auto-added
   fuzzy_match    ┤    fuzzy_match    ───┤   after each extraction run;
   manual         ┘    manual         ──┘   confirmed by analyst)

APPROVED_LINES
──────────────
approval_id (PK)
line_id (FK) ──▶ EXTRACTED_LINES
doc_id (FK)
decision (APPROVED | REJECTED | CORRECTED)
corrected_worker / corrected_date / corrected_project / corrected_hours
reason · reviewer · reviewed_ts

── VIEWS ────────────────────────────────────────────────────────────────────

TRUSTED_LEDGER          — EXTRACTED_LINES ⋈ APPROVED_LINES, corrections applied
EXTRACTION_ACCURACY     — EXTRACTED_LINES vs CURATED_GROUND_TRUTH, diff per line
PIPELINE_STATUS         — per-doc processing overview
PROJECT_CODE_SUSPECTS   — extracted codes within edit-distance 3 of confirmed master
WORKER_NAME_SUSPECTS    — extracted workers within edit-distance 3 of confirmed master

── AGGREGATES ───────────────────────────────────────────────────────────────

RECON_SUMMARY
─────────────
period_month · period_quarter
approved_hours · implied_cost
invoice_subsub_amount · invoice_my_amount
variance_subsub · variance_my
```

---

## Setup

### 1. Snowflake

Run `sql/setup.sql` in your Snowflake account. This creates:
- Database `RECONCILIATION`, schema `PUBLIC`
- Stage `DOCUMENTS_STAGE` (for OCR path) and `DOCUMENTS_STAGE_SSE` (for multimodal — must use `ENCRYPTION = (TYPE = 'SNOWFLAKE_SSE')` for `TO_FILE()` to work with Cortex)
- All tables, views, and stored procedures

Add a `[hack]` connection profile to `~/.snowflake/connections.toml`:
```toml
[hack]
account   = "your-account-identifier"
user      = "your-username"
password  = "your-password"
warehouse = "DEFAULT_WH"
```

### 2. Python Environment

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Environment Variables (for standalone scripts)

Create `.env`:
```
SNOWFLAKE_ACCOUNT=your-account
SNOWFLAKE_USER=your-user
SNOWFLAKE_PASSWORD=your-password
SNOWFLAKE_DATABASE=RECONCILIATION
SNOWFLAKE_SCHEMA=PUBLIC
SNOWFLAKE_WAREHOUSE=DEFAULT_WH
```

### 4. Run

```bash
# Streamlit app (full workflow)
streamlit run app.py

# Standalone: multimodal extraction on all staged documents
python run_extraction_cortex.py

# Standalone: legacy CrewAI extraction on hardcoded OCR samples
python run_extraction.py

# Standalone: validation of EXTRACTED_LINES
python run_validation.py
```

---

## Project Structure

```
hack/
├── app.py                      # 6-page Streamlit app
├── crew.py                     # TimesheetReconciliationCrew orchestrator
├── cortex_llm.py               # Custom litellm wrapper for Snowflake Cortex
├── run_extraction_cortex.py    # Multimodal extraction script (preferred)
├── run_extraction.py           # Legacy CrewAI extraction script
├── run_validation.py           # Validation pipeline script
├── requirements.txt
├── sql/
│   └── setup.sql               # Full Snowflake DDL + stored procedures
└── agents/
    ├── __init__.py
    ├── extraction_agent.py     # CrewAI agent: OCR text → ExtractionResult
    ├── validation_agent.py     # CrewAI agent: ValidationResult + ReconciliationResult
    └── ground_truth_agent.py   # CrewAI agent: AccuracyReport vs ground truth
```
