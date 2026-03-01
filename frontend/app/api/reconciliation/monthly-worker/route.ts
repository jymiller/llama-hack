import { NextResponse } from "next/server";
import { runQuery } from "@/lib/snowflake";

export interface MonthlyWorkerRow {
  PERIOD_MONTH: string;
  EXT_TIMESHEET_HOURS: number;
  EXT_INVOICE_HOURS: number;
  GT_HOURS: number | null;
}

export async function GET() {
  try {
    const rows = await runQuery<MonthlyWorkerRow>(`
      WITH ts AS (
        SELECT
          TO_CHAR(DATE_TRUNC('month', el.WORK_DATE::DATE), 'YYYY-MM') AS PERIOD_MONTH,
          SUM(el.HOURS) AS EXT_TIMESHEET_HOURS
        FROM EXTRACTED_LINES el
        JOIN RAW_DOCUMENTS rd ON el.DOC_ID = rd.DOC_ID
        WHERE rd.DOC_TYPE = 'TIMESHEET'
          AND el.WORK_DATE IS NOT NULL
        GROUP BY 1
      ),
      inv AS (
        SELECT
          TO_CHAR(DATE_TRUNC('month', el.WORK_DATE::DATE), 'YYYY-MM') AS PERIOD_MONTH,
          SUM(el.HOURS) AS EXT_INVOICE_HOURS
        FROM EXTRACTED_LINES el
        JOIN RAW_DOCUMENTS rd ON el.DOC_ID = rd.DOC_ID
        WHERE rd.DOC_TYPE = 'SUBSUB_INVOICE'
          AND el.WORK_DATE IS NOT NULL
        GROUP BY 1
      ),
      gt AS (
        SELECT
          TO_CHAR(DATE_TRUNC('month', WORK_DATE::DATE), 'YYYY-MM') AS PERIOD_MONTH,
          SUM(HOURS) AS GT_HOURS
        FROM CURATED_GROUND_TRUTH
        WHERE WORK_DATE IS NOT NULL
        GROUP BY 1
      )
      SELECT
        COALESCE(ts.PERIOD_MONTH, inv.PERIOD_MONTH, gt.PERIOD_MONTH) AS PERIOD_MONTH,
        COALESCE(ts.EXT_TIMESHEET_HOURS, 0) AS EXT_TIMESHEET_HOURS,
        COALESCE(inv.EXT_INVOICE_HOURS,   0) AS EXT_INVOICE_HOURS,
        gt.GT_HOURS
      FROM ts
      FULL OUTER JOIN inv ON ts.PERIOD_MONTH = inv.PERIOD_MONTH
      FULL OUTER JOIN gt  ON COALESCE(ts.PERIOD_MONTH, inv.PERIOD_MONTH) = gt.PERIOD_MONTH
      ORDER BY PERIOD_MONTH
    `);
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
