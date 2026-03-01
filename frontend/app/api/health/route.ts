import { NextResponse } from "next/server";
import { runQuery } from "@/lib/snowflake";

export async function GET() {
  const checkedAt = new Date().toISOString();

  // 1. Ping Snowflake and measure latency
  const t0 = Date.now();
  let connected = false;
  let latencyMs: number | null = null;

  try {
    await runQuery("SELECT 1 AS PING");
    latencyMs = Date.now() - t0;
    connected = true;
  } catch {
    return NextResponse.json(
      {
        status: "down",
        snowflake: { connected: false, latency_ms: null },
        pipeline: null,
        checked_at: checkedAt,
      },
      { status: 503 }
    );
  }

  // 2. Pipeline counts from PIPELINE_STATUS
  type PipelineRow = {
    TOTAL_DOCS: number;
    DOCS_EXTRACTED: number;
    DOCS_PENDING: number;
  };

  type LinesRow = {
    TOTAL_LINES: number;
    AVG_CONFIDENCE: number | null;
  };

  const [pipelineRows, linesRows] = await Promise.all([
    runQuery<PipelineRow>(`
      SELECT
        COUNT(*)                                                    AS TOTAL_DOCS,
        SUM(IFF(EXTRACTED_LINES > 0, 1, 0))                       AS DOCS_EXTRACTED,
        SUM(IFF(EXTRACTED_LINES = 0, 1, 0))                       AS DOCS_PENDING
      FROM PIPELINE_STATUS
    `),
    runQuery<LinesRow>(`
      SELECT
        COUNT(*)                             AS TOTAL_LINES,
        ROUND(AVG(EXTRACTION_CONFIDENCE), 3) AS AVG_CONFIDENCE
      FROM EXTRACTED_LINES
    `),
  ]);

  const p = pipelineRows[0] ?? { TOTAL_DOCS: 0, DOCS_EXTRACTED: 0, DOCS_PENDING: 0 };
  const l = linesRows[0] ?? { TOTAL_LINES: 0, AVG_CONFIDENCE: null };

  const status = !connected
    ? "down"
    : p.DOCS_PENDING > 0
    ? "degraded"
    : "ok";

  return NextResponse.json({
    status,
    snowflake: {
      connected,
      latency_ms: latencyMs,
    },
    pipeline: {
      total_docs: Number(p.TOTAL_DOCS),
      docs_extracted: Number(p.DOCS_EXTRACTED),
      docs_pending: Number(p.DOCS_PENDING),
      total_lines: Number(l.TOTAL_LINES),
      avg_confidence: l.AVG_CONFIDENCE !== null ? Number(l.AVG_CONFIDENCE) : null,
    },
    checked_at: checkedAt,
  });
}
