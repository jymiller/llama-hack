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

    const stagePath = `@DOCUMENTS_STAGE_SSE/${file.name}`;

    try {
      // Upload to Snowflake stage (SSE encryption required for Cortex)
      await runExecute(`PUT 'file://${tmpPath}' @DOCUMENTS_STAGE_SSE AUTO_COMPRESS=FALSE OVERWRITE=TRUE`);
    } finally {
      await unlink(tmpPath).catch(() => {});
    }

    // Upsert RAW_DOCUMENTS — update ingested_ts on re-upload so the timestamp reflects the latest file.
    // DOC_ID is derived from the filename without extension (e.g. "08-30-2025.jpg" → "08-30-2025").
    await runExecute(
      `MERGE INTO RAW_DOCUMENTS t
       USING (SELECT ? AS file_path, ? AS doc_type,
                     REGEXP_REPLACE(SPLIT_PART(?, '/', -1), '\\\\.[^.]+$', '') AS doc_id) s
         ON t.FILE_PATH = s.file_path
       WHEN MATCHED THEN UPDATE SET doc_type = s.doc_type, ingested_ts = CURRENT_TIMESTAMP()
       WHEN NOT MATCHED THEN INSERT (DOC_ID, FILE_PATH, DOC_TYPE) VALUES (s.doc_id, s.file_path, s.doc_type)`,
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
