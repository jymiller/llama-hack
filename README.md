# Timesheet Reconciliation Agent

> Built with Claude Code. Powered by Claude Cortex. Deployed as a Docker container inside Snowpark Container Services — runs entirely within Snowflake.

Two layers of AI — one to build it, one to run it.

Built for the [Llama Lounge Agentic Hackathon](https://cerebralvalley.ai/e/llama-lounge-agentic-hackathon).

---

## AI in this project

This project is a dogfood story: **Anthropic's AI built a product powered by Anthropic's AI, deployed entirely inside Snowflake.**

### Layer 1 — Claude Code built the app

The entire Next.js frontend, Snowflake stored procedures, SQL schema, and API routes were written by **Claude Code (claude-sonnet-4-6)** via an iterative pair-programming session. Zero boilerplate written by hand. The finished app is packaged as a Docker image and runs as a **React/Node.js container inside Snowpark Container Services**, with Snowflake's Secure Data Access keeping all queries within the platform perimeter.

### Layer 2 — Claude 3.5 Sonnet runs the extraction

- Timesheet screenshots (JPG) are sent directly to `claude-3-5-sonnet` via `SNOWFLAKE.CORTEX.COMPLETE` with multimodal `TO_FILE()` — no OCR pre-processing
- Invoice PDFs are parsed by `SNOWFLAKE.CORTEX.PARSE_DOCUMENT`, then structured by the same model
- All AI inference happens inside Snowflake as a SQL stored procedure call — no external API, no Python runtime, no separate service

---

## The Problem

Automating Business Processes with AI can be error prone without governance and evaluations.  This example of a back office process - that is common in every business, is demonstrated as a potential process to be automated.  
In this case, tedious back-office reconciliation of invoices against timesheets provides real value -- 
Every month, someone manually compares images to spreadsheets, hoping nothing slipped through.
Time consuming work that can be done by agents.

This system eliminates that gap — screenshots in, trusted ledger out.

This demo shows the first level of automation - AI augmentation.
With more time, we could develop a platform for Agentic Process Automation with Crew AI.

---

## Live Demo

| | |
|---|---|
| **URL** | [Agentic Reconciliation](https://iqzdjx-sfsehol-llama-lounge-hackathon-ucgals.snowflakecomputing.app) |
| **Username** | `JUDGE` |
| **Password** | *The Team Name* |

---

## How It Works

1. **Upload** timesheet images and invoice PDFs via the Next.js app
2. **Claude reads the image** — a NetSuite timesheet screenshot is sent pixel-perfect to Claude 3.5 Sonnet inside Snowflake. No OCR. No preprocessing. The model extracts worker, date, project code, and hours directly from the visual layout.
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
| Frontend | Next.js 16 (App Router) + TypeScript — React/Node.js app |
| UI | Tailwind CSS + shadcn/ui + TanStack Query v5 |
| DB client | snowflake-sdk (Node.js) via Next.js API routes — **secure data access inside the Snowflake perimeter** |
| Container | Docker image built from `frontend/` and pushed to a Snowflake image registry |
| Deployment | **Snowpark Container Services (SPCS)** — the Node.js server runs inside Snowflake's managed container runtime; no data leaves the platform |

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
