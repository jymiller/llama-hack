import { NextRequest, NextResponse } from "next/server";
import { runExecute } from "@/lib/snowflake";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await runExecute(`DELETE FROM PROJECT_CODE_MERGES WHERE MERGE_ID = ?`, [id]);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
