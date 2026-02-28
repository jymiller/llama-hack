import { NextResponse } from "next/server";
import { runQuery } from "@/lib/snowflake";
import { TrustedLedgerRow } from "@/lib/types";

export async function GET() {
  try {
    const rows = await runQuery<TrustedLedgerRow>(
      `SELECT LINE_ID, DOC_ID, WORKER, WORK_DATE, PROJECT,
              NULL AS PROJECT_CODE, HOURS,
              APPROVAL_STATUS AS DECISION,
              NULL AS CORRECTED_HOURS, NULL AS ANALYST_NOTE
       FROM TRUSTED_LEDGER
       ORDER BY DOC_ID, WORK_DATE`
    );
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
