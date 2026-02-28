import { NextRequest, NextResponse } from "next/server";
import { runQuery, runExecute } from "@/lib/snowflake";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const rows = await runQuery<{ FILE_PATH: string }>(
      `SELECT FILE_PATH FROM RAW_DOCUMENTS WHERE DOC_ID = ?`,
      [id]
    );
    if (!rows.length) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const stagePath = rows[0].FILE_PATH;

    // Remove from stage
    await runExecute(`REMOVE ${stagePath}`);

    // Delete dependent rows first, then the document record
    await runExecute(`DELETE FROM EXTRACTED_LINES WHERE doc_id = ?`, [id]);
    await runExecute(`DELETE FROM APPROVED_LINES WHERE doc_id = ?`, [id]);
    await runExecute(`DELETE FROM VALIDATION_RESULTS WHERE doc_id = ?`, [id]);
    await runExecute(`DELETE FROM CURATED_GROUND_TRUTH WHERE doc_id = ?`, [id]);
    await runExecute(`DELETE FROM RAW_DOCUMENTS WHERE doc_id = ?`, [id]);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
