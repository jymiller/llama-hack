# Timesheet Reconciliation — Next.js Frontend

Next.js 16 (App Router) analyst review app. Connects directly to Snowflake via `snowflake-sdk` from API routes — no Python, no separate backend.

## Quick Start

```bash
cp .env.local.example .env.local  # fill in Snowflake credentials
npm install
npm run dev
# → http://localhost:3000
```

## Environment Variables

Create `frontend/.env.local`:

```
SNOWFLAKE_ACCOUNT=your-account-identifier
SNOWFLAKE_USER=your-username
SNOWFLAKE_PASSWORD=your-password
SNOWFLAKE_DATABASE=RECONCILIATION
SNOWFLAKE_SCHEMA=PUBLIC
SNOWFLAKE_WAREHOUSE=DEFAULT_WH
```

## Pages

| Route | Purpose |
|---|---|
| `/documents` | Upload images/PDFs, trigger extraction |
| `/ground-truth` | Enter verified hours and compare against AI extraction |
| `/data-governance` | Confirm project codes, workers, and apply merge corrections |
| `/approvals` | Approve, reject, or correct extracted lines |
| `/reconciliation` | Monthly variance summary across timesheets, GT, and invoices |

See [../docs/app-pages.md](../docs/app-pages.md) for detailed page descriptions.

## Key Files

| File | Purpose |
|---|---|
| `lib/snowflake.ts` | Singleton Snowflake connection, `runQuery()`, `runExecute()` |
| `lib/types.ts` | TypeScript interfaces for all DB tables and views |
| `lib/utils.ts` | `cn()`, date helpers, `formatCurrency`, `formatPct` |
| `hooks/queries.ts` | All TanStack Query hooks |
| `app/api/` | Typed API routes — one directory per resource |

## Stack

- Next.js 16 App Router + TypeScript
- Tailwind CSS + shadcn/ui
- TanStack Query v5 + TanStack Table v8
- snowflake-sdk (Node.js native — `serverExternalPackages` in `next.config.ts`)
- sonner (toasts)

## Docker / SPCS

```bash
docker build --platform linux/amd64 -t recon-app .
```

See [../docs/deployment.md](../docs/deployment.md) for SPCS deployment steps.
