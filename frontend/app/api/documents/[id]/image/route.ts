import { NextRequest, NextResponse } from "next/server";
import { runQuery, runExecute } from "@/lib/snowflake";
import { readFile, mkdir, access } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const IMAGE_DIR = join(tmpdir(), "timesheet-images");

export async function GET(
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

    // Extract bare filename from stage path
    const stagePath = rows[0].FILE_PATH; // e.g. @RECONCILIATION.PUBLIC.DOCUMENTS_STAGE_UNENC/08-30-2025.jpg
    const filename = stagePath.split("/").pop()!;

    await mkdir(IMAGE_DIR, { recursive: true });

    const localPath = join(IMAGE_DIR, filename);

    // Only download if not already cached locally
    const cached = await access(localPath).then(() => true).catch(() => false);
    if (!cached) {
      // Use the full stage path from DB (e.g. @RECONCILIATION.PUBLIC.DOCUMENTS_STAGE_UNENC/file.jpg)
      await runExecute(`GET ${stagePath} file://${IMAGE_DIR}/`);
    }

    const data = await readFile(localPath);
    const ext = filename.split(".").pop()?.toLowerCase();
    const contentType =
      ext === "png" ? "image/png" :
      ext === "pdf" ? "application/pdf" :
      "image/jpeg";

    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
