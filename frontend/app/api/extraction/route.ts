import { NextResponse } from "next/server";
import { runQuery } from "@/lib/snowflake";
import { ExtractedLine } from "@/lib/types";

export async function GET() {
  try {
    const rows = await runQuery<ExtractedLine>(
      `SELECT LINE_ID, DOC_ID, WORKER, WORK_DATE, PROJECT, PROJECT_CODE,
              HOURS, EXTRACTION_CONFIDENCE,
              RAW_TEXT_SNIPPET AS RAW_TEXT, CREATED_TS AS EXTRACTED_AT
       FROM EXTRACTED_LINES
       ORDER BY DOC_ID, WORK_DATE`
    );
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
