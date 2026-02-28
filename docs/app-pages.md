# Analyst App — Page Guide

The Next.js frontend (`frontend/`) is a 5-page analyst review app. Run with `cd frontend && npm run dev` → [http://localhost:3000](http://localhost:3000).

All data reads and writes go through typed API routes (`frontend/app/api/`) backed by `runQuery()` / `runExecute()` in `lib/snowflake.ts`.

---

## Documents

Upload images and PDFs to the Snowflake SSE-encrypted stage.

- Per-card **Extract** (▶) button or **Extract All** to run `EXTRACT_DOCUMENT_MULTIMODAL` / `EXTRACT_ALL_MULTIMODAL`
- PDF thumbnails show a file icon; image thumbnails show the actual image
- Click any card to open the detail panel: image/PDF viewer + extracted lines table

---

## Ground Truth

Timesheet documents only. Lets analysts enter verified hours for accuracy comparison.

- Thumbnail row: green border = GT saved and matches extraction; red border = mismatch with delta shown (e.g. `Δ−22.0h`)
- Click a doc to open: zoom/pan image viewer above an editable SAT–FRI hours grid
- Below the grid: color-coded AI extraction comparison — green (match) or red (discrepancy) per day/project cell
- Saves to `CURATED_GROUND_TRUTH`

---

## Master Data

Four tabs for managing canonical project codes and worker names.

| Tab | Purpose |
|---|---|
| **Projects** | Confirm canonical project codes extracted from timesheets |
| **Workers** | Confirm canonical worker names |
| **Merges** | Create source→target project code merges; click Apply to call `APPLY_PROJECT_MERGES()` and hard-write corrections to `EXTRACTED_LINES` |
| **Provenance** | Audit trail of all merges applied |

The **Merges** tab shows `PROJECT_CODE_SUSPECTS` — codes within edit-distance 3 of a confirmed master record (catching OCR misreads like `006QI` → `006GI`).

---

## Approvals

Per-line analyst decisions on extracted timesheet rows.

- **APPROVE** — accepts the extracted line as-is
- **REJECT** — excludes the line from the trusted ledger
- **CORRECT** — accepts the line with modified hours, date, or project
- Bulk approve available for reviewed documents
- Decisions written to `APPROVED_LINES`; corrections flow through to `TRUSTED_LEDGER`

---

## Reconciliation

Monthly summary comparing three sources of truth side by side.

- **Timesheet hours** (from `EXTRACTED_LINES` / `TRUSTED_LEDGER`)
- **Ground truth hours** (from `CURATED_GROUND_TRUTH`)
- **Invoice hours** (from invoice docs in `EXTRACTED_LINES`)
- Variance warnings when any two sources diverge beyond tolerance
- Monthly aggregations from `RECON_SUMMARY` with variance percentage
