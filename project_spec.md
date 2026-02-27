# Screenshot → Validated Timesheet Ledger → Reconciliation

## Hackathon Specification (Snowflake + Cortex Code + CrewAI + Composio + Skyfire)

---

# 1. Purpose

This document defines the **minimum viable demo** for a subcontracting reconciliation system built during a hackathon.

The demo proves that:

> Even when the only available data consists of **screenshots and invoices**, we can automatically reconstruct a trusted timesheet ledger, validate it, and produce reconciliation reporting.

The system demonstrates:

* Document understanding
* Agent orchestration
* Enterprise reconciliation
* Real-world automation actions

---

# 2. Problem Statement

Current Situation:

* Prime contractor timesheets exist only as screenshots.
* A sub-sub contractor sends an invoice downstream.
* The subcontractor (you) invoices the Prime contractor.
* No structured system-of-record exists locally.

Before reconciliation or reporting can occur, the system must:

1. Extract timesheet data from images.
2. Validate extracted data.
3. Establish a trusted ledger.
4. Reconcile invoices against approved time.

---

# 3. Demo Outcome

### Input

* Prime contractor timesheet screenshots (images)
* Sub-sub contractor invoice image
* Subcontractor invoice image

### Output

Inside Snowflake:

1. Normalized Timesheet Ledger
2. Validation Results
3. Monthly & Quarterly Reconciliation Report
4. Exception Notification sent automatically

---

# 4. Architecture Overview

```
Images + Invoices
        ↓
Snowflake Stage
        ↓
Cortex OCR / Document Parsing
        ↓
CrewAI Agents
   (Extract → Validate → Reconcile)
        ↓
Snowflake Tables (System of Record)
        ↓
Reporting + Notifications
        ↓
Composio Actions + Skyfire Payment Event
```

---

# 5. Technology Roles

## Snowflake

Primary system of record.

Responsibilities:

* Store raw documents
* Execute OCR parsing
* Persist structured data
* Perform validation queries
* Generate reporting tables

Key Capability:

* Cortex PARSE_DOCUMENT (OCR)

---

## Cortex Code

Used as the development interface to:

* Generate schemas
* Generate SQL models
* Build validation logic
* Create Streamlit demo interface

---

## CrewAI (Open Source)

Agent orchestration layer.

Agents coordinate the workflow:

1. Extraction Agent
2. Validation/Reconciliation Agent

CrewAI performs reasoning and workflow decisions.

---

## Composio

Real-world action layer.

Used for one automation:

* Send exception notification (Slack or Gmail)

Purpose:
Demonstrate agents taking external action.

---

## Skyfire

Agent identity and payment demonstration.

Used for:

* One paid external enrichment call
* Logging economic activity of an agent

Purpose:
Demonstrate autonomous economic agents.

---

# 6. Core Workflow

## Step 1 — Document Ingestion

User uploads:

* Timesheet screenshots
* Invoice images

Files stored in Snowflake stage.

---

## Step 2 — OCR Extraction

Snowflake Cortex extracts text:

```
PARSE_DOCUMENT(..., mode='OCR')
```

Output:
Raw text blocks.

---

## Step 3 — Structured Extraction (CrewAI)

Extraction Agent converts OCR text into structured rows:

Fields:

* worker
* work_date
* project
* hours
* document_type
* extraction_confidence
* raw_text_snippet

Result stored in:

`EXTRACTED_LINES`

---

## Step 4 — Validation

Validation Agent applies rules at three levels.

---

### A. Document-Level Validation

Checks:

* worker identifiable
* reporting period present
* totals detected
* extraction confidence acceptable

---

### B. Line-Level Validation

Checks:

* valid date format
* numeric hours
* hours between 0–24
* required fields present

---

### C. Cross-Artifact Validation

Business validation:

```
Approved Hours × Rate
≈ Invoice Amount
```

Performed for:

* Sub-sub invoice
* Subcontractor invoice

Variances recorded.

---

## Step 5 — Ledger Creation

Validated entries become the **Trusted Timesheet Ledger**.

This ledger becomes the foundation for all reporting.

---

## Step 6 — Reconciliation

System calculates:

* Approved hours
* Implied labor cost
* Invoice totals
* Variances

Results stored in `RECON_SUMMARY`.

---

## Step 7 — Agent Action

If validation fails or variance exceeds tolerance:

CrewAI triggers Composio action:

* Send exception report
* Request confirmation

---

## Step 8 — Economic Agent Demonstration

Agent performs one external paid action via Skyfire.

Example:

* enrichment lookup
* verification call

Receipt logged back into Snowflake.

---

# 7. Data Model

---

## RAW_DOCUMENTS

| Column      | Description                             |
| ----------- | --------------------------------------- |
| doc_id      | Unique identifier                       |
| doc_type    | TIMESHEET / SUBSUB_INVOICE / MY_INVOICE |
| file_path   | Stage location                          |
| ingested_ts | Timestamp                               |

---

## EXTRACTED_LINES

| Column                | Description        |
| --------------------- | ------------------ |
| line_id               | Unique line        |
| doc_id                | Source document    |
| worker                | Worker name/id     |
| work_date             | Date               |
| project               | Project identifier |
| hours                 | Extracted hours    |
| extraction_confidence | OCR confidence     |
| raw_text_snippet      | Audit trace        |

---

## VALIDATION_RESULTS

| Column         | Description             |
| -------------- | ----------------------- |
| validation_id  | Unique id               |
| doc_id         | Document                |
| line_id        | Optional line reference |
| rule_name      | Validation rule         |
| status         | PASS / FAIL / WARN      |
| details        | Explanation             |
| computed_value | Supporting data         |

---

## RECON_SUMMARY

| Column                | Description        |
| --------------------- | ------------------ |
| period_month          | Month              |
| period_quarter        | Quarter            |
| approved_hours        | Total hours        |
| implied_cost          | Derived cost       |
| invoice_subsub_amount | Downstream invoice |
| invoice_my_amount     | Upstream invoice   |
| variance_subsub       | Difference         |
| variance_my           | Difference         |

---

# 8. Validation Rules (Minimal Set)

### Required Rules

* Hours numeric
* Date valid
* Hours within range
* Worker present
* Totals match within tolerance

### Recommended Tolerance

```
±1% or configurable threshold
```

---

# 9. Reporting Outputs

System generates:

## Monthly Report

* Total hours
* Total spend
* Variance summary

## Quarterly Report

* Aggregated totals
* Trend view

---

# 10. Demo Script (1 Minute)

1. Upload screenshots + invoices.
2. Click **Run Extraction & Validation**.
3. Show populated ledger table.
4. Show validation results.
5. Show reconciliation summary.
6. Show automated notification sent.
7. Show Skyfire transaction logged.

---

# 11. Success Criteria

The demo succeeds if it proves:

* Screenshots can become structured enterprise data.
* Agents validate before financial decisions occur.
* Snowflake becomes the trusted reconciliation ledger.
* Agents can act externally and economically.

---

# 12. Non-Goals

Out of scope for hackathon:

* Full accounting system
* Perfect OCR accuracy
* Multi-client scaling
* Production security hardening

---

# 13. Core Insight

This system does **not** automate approvals.

It automates:

> Establishing trust when structured systems do not exist.

The product demonstrated is a:

**Time Reconciliation Agent powered by Snowflake and autonomous agents.**

---

