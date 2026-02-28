import { NextRequest, NextResponse } from "next/server";
import { runQuery, runExecute } from "@/lib/snowflake";
import { RawDocument } from "@/lib/types";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const docs = await runQuery<RawDocument>(
      `SELECT DOC_ID, FILE_PATH AS FILE_NAME, DOC_TYPE, FILE_PATH AS STAGE_PATH FROM RAW_DOCUMENTS WHERE DOC_ID = ?`,
      [id]
    );
    if (!docs.length) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    const doc = docs[0];

    await runExecute(
      `CALL PROCESS_DOCUMENT_OCR(?, ?, ?)`,
      [doc.DOC_ID, doc.DOC_TYPE, doc.STAGE_PATH]
    );

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
