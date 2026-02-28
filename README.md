# Timesheet Reconciliation Agent

Converts timesheet screenshots and subcontract invoice PDFs into a trusted, validated financial ledger — automatically. Built on **Snowflake Cortex** (Claude 3.5 Sonnet) and a **Next.js** analyst app.

Built for the [Llama Lounge Agentic Hackathon](https://cerebralvalley.ai/e/llama-lounge-agentic-hackathon).

---

## The Problem

Subcontracting billing chains create a silent audit gap: the prime contractor holds timesheet screenshots, the agency holds invoices, and neither side has a structured system of record. Every month, someone manually compares images to spreadsheets, hoping nothing slipped through.

This system eliminates that gap — screenshots in, trusted ledger out.

---

## Live Demo

| | |
|---|---|
| **URL** | `https://iqzdjx-sfsehol-llama-lounge-hackathon-ucgals.snowflakecomputing.app` |
| **Username** | `JUDGE` |
| **Password** | *(ask the team)* |

---

## How It Works

1. **Upload** timesheet images and invoice PDFs via the Next.js app
2. **Extract** — Snowflake stored procedures call `SNOWFLAKE.CORTEX.COMPLETE` (Claude 3.5 Sonnet) to parse every image and PDF directly — no Python, no agents
3. **Curate** — fuzzy-match suspects (edit-distance ≤ 3) surface OCR misreads; analysts confirm or merge project codes
4. **Approve** — analysts approve, reject, or correct extracted lines per row
5. **Reconcile** — `TRUSTED_LEDGER` view becomes the financial system of record; `RECON_SUMMARY` flags variances between timesheet hours and invoice totals

---

## Tech Stack

| Layer | Technology |
|---|---|
| Data store | Snowflake `RECONCILIATION.PUBLIC` |
| AI extraction | `SNOWFLAKE.CORTEX.COMPLETE` — claude-3-5-sonnet (multimodal for images, text for PDFs) |
| PDF parsing | `SNOWFLAKE.CORTEX.PARSE_DOCUMENT` |
| Frontend | Next.js 16 (App Router) + TypeScript |
| UI | Tailwind CSS + shadcn/ui + TanStack Query v5 |
| DB client | snowflake-sdk (Node.js) from Next.js API routes |
| Deployment | Snowpark Container Services (SPCS) |

---

## Quick Start

```bash
# 1. Set up Snowflake schema
# Run sql/setup.sql in your Snowflake account

# 2. Configure and run the Next.js app
cd frontend
cp .env.local.example .env.local  # fill in your Snowflake credentials
npm install && npm run dev
# → http://localhost:3000
```

See [docs/setup.md](docs/setup.md) for full instructions.

---

## Documentation

| Doc | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Data flow diagram, LLM call details, trusted ledger SQL |
| [docs/data-model.md](docs/data-model.md) | Full schema with tables, views, and stored procedures |
| [docs/app-pages.md](docs/app-pages.md) | Per-page guide to the analyst UI |
| [docs/setup.md](docs/setup.md) | Snowflake setup + Next.js local dev |
| [docs/deployment.md](docs/deployment.md) | SPCS Docker deployment guide |
| [docs/project-spec.md](docs/project-spec.md) | Original hackathon specification |

---

## Project Structure

```
hack/
├── sql/setup.sql          # Full Snowflake DDL: tables, views, stored procedures
├── frontend/              # Next.js 16 analyst app (primary UI)
│   ├── app/               # 5 pages + API routes → Snowflake
│   ├── lib/snowflake.ts   # Singleton connection + runQuery/runExecute
│   └── lib/types.ts       # TypeScript interfaces for all DB tables/views
├── docs/                  # Architecture, setup, deployment, and spec docs
└── requirements.txt       # Python deps (kept for reference; not used by live app)
```
