import { NextResponse } from "next/server";
import { runQuery } from "@/lib/snowflake";

export async function GET() {
  try {
    const rows = await runQuery<{ DOC_ID: string; ROW_COUNT: number }>(
      `SELECT DOC_ID, COUNT(*) AS ROW_COUNT
       FROM CURATED_GROUND_TRUTH
       GROUP BY DOC_ID`
    );
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
