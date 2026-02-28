import { NextRequest, NextResponse } from "next/server";
import { runQuery, runExecute } from "@/lib/snowflake";
import { ProjectCodeMerge } from "@/lib/types";

export async function GET() {
  try {
    const rows = await runQuery<ProjectCodeMerge>(
      `SELECT
         m.MERGE_ID, m.SOURCE_CODE, m.TARGET_CODE,
         src.PROJECT_NAME AS SOURCE_NAME,
         tgt.PROJECT_NAME AS TARGET_NAME,
         m.MERGE_REASON, m.MERGED_BY, m.MERGED_AT
       FROM PROJECT_CODE_MERGES m
       LEFT JOIN CURATED_PROJECTS src ON src.PROJECT_CODE = m.SOURCE_CODE
       LEFT JOIN CURATED_PROJECTS tgt ON tgt.PROJECT_CODE = m.TARGET_CODE
       ORDER BY m.MERGED_AT DESC`
    );
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: {
      source_code: string;
      target_code: string;
      merge_reason?: string;
    } = await req.json();

    await runExecute(
      `INSERT INTO PROJECT_CODE_MERGES (SOURCE_CODE, TARGET_CODE, MERGE_REASON, MERGED_BY)
       VALUES (?, ?, ?, 'analyst')`,
      [body.source_code, body.target_code, body.merge_reason ?? null]
    );
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
