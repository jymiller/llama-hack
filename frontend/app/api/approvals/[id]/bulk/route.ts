import { NextRequest, NextResponse } from "next/server";
import { runQuery, runExecute } from "@/lib/snowflake";
import { ExtractedLine } from "@/lib/types";

// POST: approve-all lines for a document
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const lines = await runQuery<ExtractedLine>(
      `SELECT LINE_ID FROM EXTRACTED_LINES WHERE DOC_ID = ?`,
      [id]
    );

    for (const line of lines) {
      await runExecute(
        `MERGE INTO APPROVED_LINES AS target
         USING (SELECT ? AS LINE_ID, ? AS DOC_ID) AS src
           ON target.LINE_ID = src.LINE_ID
         WHEN MATCHED THEN UPDATE SET
           DECISION = 'APPROVED', REVIEWED_TS = CURRENT_TIMESTAMP()
         WHEN NOT MATCHED THEN INSERT
           (LINE_ID, DOC_ID, DECISION)
         VALUES (?, ?, 'APPROVED')`,
        [line.LINE_ID, id, line.LINE_ID, id]
      );
    }

    return NextResponse.json({ success: true, approved: lines.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: clear all approvals for a document
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await runExecute(`DELETE FROM APPROVED_LINES WHERE DOC_ID = ?`, [id]);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
