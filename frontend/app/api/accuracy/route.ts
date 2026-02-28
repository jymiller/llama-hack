import { NextResponse } from "next/server";
import { runQuery } from "@/lib/snowflake";
import { AccuracyRow } from "@/lib/types";

export async function GET() {
  try {
    const rows = await runQuery<AccuracyRow>(
      `SELECT DOC_ID, NULL AS WORKER, WORK_DATE,
              EXT_HOURS AS EXTRACTED_HOURS, GT_HOURS, HOURS_DELTA,
              NULL AS EXTRACTION_CONFIDENCE
       FROM EXTRACTION_ACCURACY
       ORDER BY DOC_ID, WORK_DATE`
    );
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
