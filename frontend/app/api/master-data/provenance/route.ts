import { NextResponse } from "next/server";
import { runQuery } from "@/lib/snowflake";
import { MergeProvenanceRow } from "@/lib/types";

export async function GET() {
  try {
    const rows = await runQuery<MergeProvenanceRow>(
      `SELECT
         CANONICAL_CODE, CANONICAL_NAME, CANONICAL_ACTIVE,
         SOURCE_CODE, SOURCE_NAME,
         MERGE_REASON, MERGED_BY, MERGED_AT, LINES_AFFECTED
       FROM PROJECT_MERGE_PROVENANCE
       ORDER BY CANONICAL_CODE, MERGED_AT`
    );
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
