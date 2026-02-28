import { NextRequest, NextResponse } from "next/server";
import { runQuery, runExecute } from "@/lib/snowflake";
import { RawDocument } from "@/lib/types";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

export async function GET() {
  try {
    const rows = await runQuery<RawDocument>(
      `SELECT DOC_ID, FILE_PATH AS FILE_NAME, DOC_TYPE, FILE_PATH AS STAGE_PATH,
              OCR_TEXT, INGESTED_TS,
              IFF(OCR_STATUS = 'COMPLETED', TRUE, FALSE) AS PROCESSED
       FROM RAW_DOCUMENTS
       ORDER BY INGESTED_TS DESC`
    );
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const docType = formData.get("doc_type") as string;

    if (!file || !docType) {
      return NextResponse.json(
        { error: "file and doc_type are required" },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const tmpPath = join(tmpdir(), `${randomUUID()}_${file.name}`);
    await writeFile(tmpPath, buffer);

    const stagePath = `@DOCUMENTS_STAGE/${file.name}`;

    try {
      // Upload to Snowflake stage
      await runExecute(`PUT 'file://${tmpPath}' @DOCUMENTS_STAGE AUTO_COMPRESS=FALSE OVERWRITE=TRUE`);
    } finally {
      await unlink(tmpPath).catch(() => {});
    }

    // Register in RAW_DOCUMENTS
    await runExecute(
      `INSERT INTO RAW_DOCUMENTS (FILE_PATH, DOC_TYPE)
       SELECT ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM RAW_DOCUMENTS WHERE FILE_PATH = ?)`,
      [stagePath, docType, stagePath]
    );

    const rows = await runQuery<RawDocument>(
      `SELECT DOC_ID, FILE_PATH AS FILE_NAME, DOC_TYPE, FILE_PATH AS STAGE_PATH,
              OCR_TEXT, INGESTED_TS, IFF(OCR_STATUS = 'COMPLETED', TRUE, FALSE) AS PROCESSED
       FROM RAW_DOCUMENTS WHERE FILE_PATH = ? ORDER BY INGESTED_TS DESC LIMIT 1`,
      [stagePath]
    );
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
