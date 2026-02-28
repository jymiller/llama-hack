import { NextResponse } from "next/server";
import { runQuery } from "@/lib/snowflake";

export interface MonthlyWorkerRow {
  WORKER: string;
  PERIOD_MONTH: string;
  EXT_TIMESHEET_HOURS: number;
  EXT_INVOICE_HOURS: number;
  GT_HOURS: number | null;
}

export async function GET() {
  try {
    const rows = await runQuery<MonthlyWorkerRow>(`
      WITH ext AS (
        SELECT
          el.WORKER,
          TO_CHAR(DATE_TRUNC('month', el.WORK_DATE::DATE), 'YYYY-MM') AS PERIOD_MONTH,
          SUM(CASE WHEN rd.DOC_TYPE = 'TIMESHEET'      THEN el.HOURS ELSE 0 END) AS EXT_TIMESHEET_HOURS,
          SUM(CASE WHEN rd.DOC_TYPE = 'SUBSUB_INVOICE' THEN el.HOURS ELSE 0 END) AS EXT_INVOICE_HOURS
        FROM EXTRACTED_LINES el
        JOIN RAW_DOCUMENTS rd ON el.DOC_ID = rd.DOC_ID
        WHERE el.WORKER IS NOT NULL AND el.WORK_DATE IS NOT NULL
        GROUP BY 1, 2
      ),
      gt AS (
        SELECT
          WORKER,
          TO_CHAR(DATE_TRUNC('month', WORK_DATE::DATE), 'YYYY-MM') AS PERIOD_MONTH,
          SUM(HOURS) AS GT_HOURS
        FROM CURATED_GROUND_TRUTH
        WHERE WORKER IS NOT NULL AND WORK_DATE IS NOT NULL
        GROUP BY 1, 2
      )
      SELECT
        COALESCE(e.WORKER,       g.WORKER)       AS WORKER,
        COALESCE(e.PERIOD_MONTH, g.PERIOD_MONTH) AS PERIOD_MONTH,
        COALESCE(e.EXT_TIMESHEET_HOURS, 0)       AS EXT_TIMESHEET_HOURS,
        COALESCE(e.EXT_INVOICE_HOURS,   0)        AS EXT_INVOICE_HOURS,
        g.GT_HOURS
      FROM ext e
      FULL OUTER JOIN gt g ON e.WORKER = g.WORKER AND e.PERIOD_MONTH = g.PERIOD_MONTH
      ORDER BY PERIOD_MONTH, WORKER
    `);
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
