import { NextRequest, NextResponse } from "next/server";
import { runQuery, runExecute } from "@/lib/snowflake";
import { ReconSummary, TrustedLedgerRow, ExtractedLine } from "@/lib/types";

export async function GET() {
  try {
    const [summary, ledger, extracted] = await Promise.all([
      runQuery<ReconSummary>(
        `SELECT RECON_ID, PERIOD_MONTH, NULL AS WORKER, APPROVED_HOURS,
                NULL AS HOURLY_RATE, IMPLIED_COST AS COMPUTED_AMOUNT,
                INVOICE_SUBSUB_AMOUNT AS INVOICE_AMOUNT,
                VARIANCE_SUBSUB AS VARIANCE, NULL AS VARIANCE_PCT,
                NULL AS STATUS, CREATED_TS AS CREATED_AT
         FROM RECON_SUMMARY
         ORDER BY PERIOD_MONTH`
      ),
      runQuery<TrustedLedgerRow>(
        `SELECT LINE_ID, DOC_ID, WORKER, WORK_DATE, PROJECT,
                NULL AS PROJECT_CODE, HOURS,
                APPROVAL_STATUS AS DECISION,
                NULL AS CORRECTED_HOURS, NULL AS ANALYST_NOTE
         FROM TRUSTED_LEDGER
         ORDER BY WORK_DATE`
      ),
      runQuery<ExtractedLine>(
        `SELECT LINE_ID, DOC_ID, WORKER, WORK_DATE, PROJECT, PROJECT_CODE,
                HOURS, EXTRACTION_CONFIDENCE,
                RAW_TEXT_SNIPPET AS RAW_TEXT, CREATED_TS AS EXTRACTED_AT
         FROM EXTRACTED_LINES
         ORDER BY WORK_DATE`
      ),
    ]);
    return NextResponse.json({ summary, ledger, extracted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { rate } = await req.json();
    await runExecute(`CALL POPULATE_RECON_SUMMARY(?)`, [rate ?? 150]);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
