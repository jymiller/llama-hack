# Setup

## 1. Snowflake

Run `sql/setup.sql` in your Snowflake account. This creates:
- Database `RECONCILIATION`, schema `PUBLIC`
- Stage `DOCUMENTS_STAGE_SSE` (SSE-encrypted — required for `CORTEX.COMPLETE` with `TO_FILE()` and `CORTEX.PARSE_DOCUMENT`)
- All tables, views, and stored procedures

Add a `[hack]` connection profile to `~/.snowflake/connections.toml`:

```toml
[hack]
account   = "your-account-identifier"
user      = "your-username"
password  = "your-password"
warehouse = "DEFAULT_WH"
```

## 2. Next.js Frontend

Create `frontend/.env.local`:

```
SNOWFLAKE_ACCOUNT=your-account
SNOWFLAKE_USER=your-user
SNOWFLAKE_PASSWORD=your-password
SNOWFLAKE_DATABASE=RECONCILIATION
SNOWFLAKE_SCHEMA=PUBLIC
SNOWFLAKE_WAREHOUSE=DEFAULT_WH
```

Install and run:

```bash
cd frontend && npm install && npm run dev
# → http://localhost:3000
```

## 3. (Optional) Python Scripts

The Python scripts in the root (`run_extraction_cortex.py`) are standalone utilities that also call the Snowflake stored procedures. They read credentials from a `.env` file:

```
SNOWFLAKE_ACCOUNT=...
SNOWFLAKE_USER=...
SNOWFLAKE_PASSWORD=...
SNOWFLAKE_DATABASE=RECONCILIATION
SNOWFLAKE_SCHEMA=PUBLIC
SNOWFLAKE_WAREHOUSE=DEFAULT_WH
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Run extraction:

```bash
source .venv/bin/activate
python run_extraction_cortex.py
```

## Technology Requirements

| Requirement | Notes |
|---|---|
| Snowflake account with Cortex enabled | Needs `SNOWFLAKE.CORTEX.COMPLETE` and `SNOWFLAKE.CORTEX.PARSE_DOCUMENT` |
| Claude 3.5 Sonnet access via Cortex | Enabled in supported Snowflake regions |
| Node.js 18+ | For Next.js frontend |
| Python 3.10+ | For optional standalone scripts |
