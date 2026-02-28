import { NextRequest, NextResponse } from "next/server";
import { runQuery, runExecute } from "@/lib/snowflake";
import { GroundTruthLine } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rows = await runQuery<GroundTruthLine>(
      `SELECT GT_LINE_ID AS GT_ID, DOC_ID, WORKER, WORK_DATE, PROJECT,
              NULL AS PROJECT_CODE, HOURS, ENTERED_BY, ENTERED_TS AS ENTERED_AT
       FROM GROUND_TRUTH_LINES
       WHERE DOC_ID = ?
       ORDER BY WORK_DATE`,
      [id]
    );
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const lines: Omit<GroundTruthLine, "GT_ID" | "ENTERED_AT">[] =
      await req.json();

    await runExecute(
      `DELETE FROM GROUND_TRUTH_LINES WHERE DOC_ID = ?`,
      [id]
    );

    for (const line of lines) {
      await runExecute(
        `INSERT INTO GROUND_TRUTH_LINES (DOC_ID, WORKER, WORK_DATE, PROJECT, HOURS, ENTERED_BY)
         VALUES (?, ?, ?, ?, ?, 'analyst')`,
        [
          id,
          line.WORKER,
          line.WORK_DATE,
          line.PROJECT ?? null,
          line.HOURS,
        ]
      );
    }

    return NextResponse.json({ success: true, count: lines.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
