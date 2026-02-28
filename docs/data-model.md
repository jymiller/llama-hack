# Data Model

```
── RAW TIER ─────────────────────────────────────────────────────────────────

RAW_DOCUMENTS          EXTRACTED_LINES
─────────────          ───────────────
doc_id (PK)    ──┬──▶  line_id (PK)
doc_type            │   doc_id (FK)
stage_path          │   worker
doc_status          │   work_date
ingested_ts         │   project
                    │   project_code
                    │   hours
                    │   extraction_confidence
                    │   raw_line_json (VARIANT)

── CURATED TIER ─────────────────────────────────────────────────────────────

CURATED_PROJECTS       CURATED_WORKERS         CURATED_GROUND_TRUTH
────────────────       ───────────────         ────────────────────
project_code (PK)      worker_key (PK)         gt_id (PK)
project_name           display_name            doc_id (FK)
confirmed              confirmed               worker
is_active              is_active               work_date
curation_source        curation_source         project
curation_note          curation_note           project_code
                                               hours
                                               entered_by

PROJECT_CODE_MERGES    APPROVED_LINES
───────────────────    ──────────────
merge_id (PK)          approval_id (PK)
source_code            line_id (FK) ──▶ EXTRACTED_LINES
target_code            doc_id (FK)
merge_reason           decision (APPROVED | REJECTED | CORRECTED)
merged_by              corrected_worker / corrected_date
merged_at              corrected_project / corrected_hours
                       reviewer · reviewed_ts

── VIEWS ────────────────────────────────────────────────────────────────────

TRUSTED_LEDGER            — EXTRACTED_LINES ⋈ APPROVED_LINES, corrections + merge resolution
PIPELINE_STATUS           — per-doc processing overview
PROJECT_CODE_SUSPECTS     — extracted codes within edit-distance 3 of confirmed master
WORKER_NAME_SUSPECTS      — extracted workers within edit-distance 3 of confirmed master
PROJECT_MERGE_PROVENANCE  — canonical codes with all merged sources listed

── AGGREGATES ───────────────────────────────────────────────────────────────

RECON_SUMMARY
─────────────
period_month
approved_hours · hourly_rate · computed_amount
invoice_amount · variance · variance_pct · status
```

---

## Table Reference

| Table / View | Purpose |
|---|---|
| `RAW_DOCUMENTS` | Document metadata; `doc_type` ∈ `{TIMESHEET, SUBSUB_INVOICE, MY_INVOICE}` |
| `EXTRACTED_LINES` | AI-extracted rows with worker, work_date, project, project_code, hours, confidence |
| `CURATED_PROJECTS` | Confirmed canonical project codes (auto-populated + analyst-confirmed) |
| `CURATED_WORKERS` | Confirmed canonical worker names |
| `CURATED_GROUND_TRUTH` | Analyst-entered correct hours for timesheet documents |
| `APPROVED_LINES` | Per-line analyst decisions: `APPROVED`, `REJECTED`, or `CORRECTED` |
| `PROJECT_CODE_MERGES` | Source → target project code corrections applied to extracted data |
| `TRUSTED_LEDGER` | View: approved/corrected lines with corrections applied and codes resolved |
| `PIPELINE_STATUS` | View: per-document processing status overview |
| `PROJECT_CODE_SUSPECTS` | View: extracted codes within edit-distance 3 of a confirmed master record |
| `WORKER_NAME_SUSPECTS` | View: extracted workers within edit-distance 3 of a confirmed master record |
| `PROJECT_MERGE_PROVENANCE` | View: canonical codes with all merged sources listed |
| `RECON_SUMMARY` | Monthly reconciliation: approved hours × rate vs invoice amounts + variances |

---

## Stored Procedures

| Procedure | Description |
|---|---|
| `EXTRACT_DOCUMENT_MULTIMODAL(doc_id)` | Extracts a single document (image via Claude vision, PDF via PARSE_DOCUMENT + COMPLETE) |
| `EXTRACT_ALL_MULTIMODAL()` | Runs extraction across all unprocessed documents in a single set-based INSERT |
| `SYNC_CURATED_MASTER()` | Auto-populates CURATED_PROJECTS and CURATED_WORKERS from newly extracted data |
| `APPLY_PROJECT_MERGES()` | Hard-writes PROJECT_CODE_MERGES corrections back into EXTRACTED_LINES |
