import { NextResponse } from "next/server";
import { runQuery, runExecute } from "@/lib/snowflake";
import { ValidationResult, PipelineStatus } from "@/lib/types";

export async function GET() {
  try {
    const [results, pipeline] = await Promise.all([
      runQuery<ValidationResult>(
        `SELECT VALIDATION_ID AS RESULT_ID, DOC_ID, LINE_ID,
                RULE_NAME AS CHECK_NAME, STATUS, DETAILS AS MESSAGE,
                CREATED_TS AS CHECKED_AT
         FROM VALIDATION_RESULTS
         ORDER BY DOC_ID, CREATED_TS DESC`
      ),
      runQuery<PipelineStatus>(
        `SELECT ps.DOC_ID, rd.FILE_PATH AS FILE_NAME, ps.DOC_TYPE,
                IFF(ps.OCR_STATUS = 'COMPLETED', TRUE, FALSE) AS OCR_DONE,
                IFF(ps.EXTRACTED_LINES > 0, TRUE, FALSE) AS EXTRACTION_DONE,
                IFF(ps.VALIDATION_CHECKS > 0, TRUE, FALSE) AS VALIDATION_DONE,
                FALSE AS APPROVAL_DONE
         FROM PIPELINE_STATUS ps
         JOIN RAW_DOCUMENTS rd ON rd.DOC_ID = ps.DOC_ID`
      ),
    ]);
    return NextResponse.json({ results, pipeline });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    await runExecute(`CALL RUN_VALIDATION()`);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
