# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Run the Streamlit app:**
```bash
source .venv/bin/activate
streamlit run app.py
```

**Run pipeline scripts directly:**
```bash
# Multimodal extraction (preferred — sends images to Claude vision via Cortex)
python run_extraction_cortex.py

# Legacy OCR-based extraction (via CrewAI agents)
python run_extraction.py

# Validation
python run_validation.py
```

**Install dependencies:**
```bash
pip install -r requirements.txt
```

**Snowflake setup (first time):**
```sql
-- Run sql/setup.sql in Snowflake to create all tables, views, and stored procedures
```

## Architecture

This is a **hackathon-grade timesheet reconciliation system** that converts timesheet screenshots and invoice images into a trusted financial ledger, validated and stored in Snowflake.

### Data Flow

```
Image files → Snowflake Stage (@DOCUMENTS_STAGE_UNENC)
            → EXTRACT_DOCUMENT_MULTIMODAL / EXTRACT_ALL_MULTIMODAL (Snowflake stored procs)
            → Claude 3.5 Sonnet via SNOWFLAKE.CORTEX.COMPLETE (multimodal)
            → EXTRACTED_LINES (structured rows)
            → Analyst review in Streamlit (Ground Truth Entry + Approval Workflow)
            → TRUSTED_LEDGER view (approved/corrected lines only)
            → RECON_SUMMARY (reconciliation results)
```

### Key Files

- **`app.py`** — 6-page Streamlit app. Connects to Snowflake via `~/.snowflake/connections.toml` (connection name: `hack`), database `RECONCILIATION.PUBLIC`.
- **`crew.py`** — `TimesheetReconciliationCrew` class orchestrating CrewAI agents for legacy OCR-based extraction, validation, and reconciliation.
- **`agents/`** — Three CrewAI agents: `extraction_agent.py` (OCR→structured data), `validation_agent.py` (rules + reconciliation math), `ground_truth_agent.py` (accuracy comparison).
- **`cortex_llm.py`** — Custom `litellm`-based wrapper to use `SNOWFLAKE.CORTEX.COMPLETE` as a CrewAI LLM.
- **`sql/setup.sql`** — Full Snowflake DDL: tables, views (`TRUSTED_LEDGER`, `EXTRACTION_ACCURACY`, `PIPELINE_STATUS`), and stored procedures (`EXTRACT_DOCUMENT_MULTIMODAL`, `EXTRACT_ALL_MULTIMODAL`, `PROCESS_DOCUMENT_OCR`).

### Two Extraction Paths

1. **Primary (multimodal):** Snowflake stored procedure `EXTRACT_DOCUMENT_MULTIMODAL` sends image files directly to `claude-3-5-sonnet` via `SNOWFLAKE.CORTEX.COMPLETE`, returning JSON parsed into `EXTRACTED_LINES`. `EXTRACT_ALL_MULTIMODAL` runs this in parallel across all documents via a single set-based INSERT.

2. **Legacy (CrewAI):** Python `TimesheetReconciliationCrew` fetches OCR text from `RAW_DOCUMENTS.ocr_text` (produced by `PROCESS_DOCUMENT_OCR` using `SNOWFLAKE.CORTEX.PARSE_DOCUMENT`) and passes it to the extraction agent.

### Snowflake Data Model

| Table/View | Purpose |
|---|---|
| `RAW_DOCUMENTS` | Document metadata + OCR text; `doc_type` ∈ `{TIMESHEET, SUBSUB_INVOICE, MY_INVOICE}` |
| `EXTRACTED_LINES` | AI-extracted rows with `worker`, `work_date`, `project`, `project_code`, `hours`, `extraction_confidence` |
| `GROUND_TRUTH_LINES` | Analyst-entered correct data (entered via Streamlit Page 3) |
| `LEDGER_APPROVALS` | Per-line analyst decisions: `APPROVED`, `REJECTED`, or `CORRECTED` |
| `VALIDATION_RESULTS` | Rule checks: `PASS`/`FAIL`/`WARN` per line/document |
| `RECON_SUMMARY` | Monthly reconciliation: `approved_hours × rate` vs invoice amounts + variances |
| `TRUSTED_LEDGER` (view) | Only approved/corrected lines with corrections applied |
| `EXTRACTION_ACCURACY` (view) | Side-by-side comparison of extracted vs ground truth hours |
| `PIPELINE_STATUS` (view) | Per-document processing status overview |

### Snowflake Connection

The app reads `~/.snowflake/connections.toml` looking for a `[hack]` connection profile. Standalone scripts read env vars: `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_PASSWORD`, `SNOWFLAKE_DATABASE`, `SNOWFLAKE_SCHEMA`, `SNOWFLAKE_WAREHOUSE` (via `.env` file + `python-dotenv`).

### Validation Rules

Applied by `validation_agent.py` (CrewAI) or via SQL queries:
- Document-level: worker identifiable, reporting period present, average confidence ≥ 0.7
- Line-level: valid date (YYYY-MM-DD), numeric hours, hours in 0–24 range, required fields present
- Cross-artifact: `approved_hours × hourly_rate` within ±1% (configurable) of invoice totals
