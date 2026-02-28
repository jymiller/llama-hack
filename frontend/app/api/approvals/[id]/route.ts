import { NextRequest, NextResponse } from "next/server";
import { runQuery, runExecute } from "@/lib/snowflake";
import { ApprovalLineRow } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const rows = await runQuery<ApprovalLineRow>(
      `SELECT el.LINE_ID, el.DOC_ID, el.WORKER, el.WORK_DATE, el.PROJECT,
              el.PROJECT_CODE, el.HOURS, el.EXTRACTION_CONFIDENCE,
              el.RAW_TEXT_SNIPPET AS RAW_TEXT, el.CREATED_TS AS EXTRACTED_AT,
              la.DECISION, la.CORRECTED_HOURS, la.CORRECTED_DATE,
              la.CORRECTED_PROJECT, la.REASON AS ANALYST_NOTE,
              gt.HOURS AS GT_HOURS
       FROM EXTRACTED_LINES el
       LEFT JOIN LEDGER_APPROVALS la ON la.LINE_ID = el.LINE_ID
       LEFT JOIN GROUND_TRUTH_LINES gt
         ON gt.DOC_ID = el.DOC_ID AND gt.WORK_DATE = el.WORK_DATE AND gt.WORKER = el.WORKER
       WHERE el.DOC_ID = ?
       ORDER BY el.WORK_DATE`,
      [id]
    );
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: {
      line_id: number;
      decision: "APPROVED" | "REJECTED" | "CORRECTED";
      corrected_hours?: number | null;
      corrected_date?: string | null;
      corrected_project?: string | null;
      analyst_note?: string | null;
    } = await req.json();

    await runExecute(
      `MERGE INTO LEDGER_APPROVALS AS target
       USING (SELECT ? AS LINE_ID, ? AS DOC_ID) AS src
         ON target.LINE_ID = src.LINE_ID
       WHEN MATCHED THEN UPDATE SET
         DECISION = ?,
         CORRECTED_HOURS = ?,
         CORRECTED_DATE = ?,
         CORRECTED_PROJECT = ?,
         REASON = ?,
         REVIEWED_TS = CURRENT_TIMESTAMP()
       WHEN NOT MATCHED THEN INSERT
         (LINE_ID, DOC_ID, DECISION, CORRECTED_HOURS, CORRECTED_DATE, CORRECTED_PROJECT, REASON)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        body.line_id,
        id,
        body.decision,
        body.corrected_hours ?? null,
        body.corrected_date ?? null,
        body.corrected_project ?? null,
        body.analyst_note ?? null,
        body.line_id,
        id,
        body.decision,
        body.corrected_hours ?? null,
        body.corrected_date ?? null,
        body.corrected_project ?? null,
        body.analyst_note ?? null,
      ]
    );

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
