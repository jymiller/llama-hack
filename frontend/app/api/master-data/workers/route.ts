import { NextRequest, NextResponse } from "next/server";
import { runQuery, runExecute } from "@/lib/snowflake";
import { CuratedWorker, WorkerNameSuspect } from "@/lib/types";

export async function GET() {
  try {
    const [workers, suspects] = await Promise.all([
      runQuery<CuratedWorker>(
        `SELECT WORKER_KEY, DISPLAY_NAME, CONFIRMED, IS_ACTIVE,
                FIRST_SEEN, ADDED_AT, CURATION_SOURCE, CURATION_NOTE
         FROM CURATED_WORKERS
         ORDER BY CONFIRMED ASC, CURATION_SOURCE, WORKER_KEY`
      ),
      runQuery<WorkerNameSuspect>(
        `SELECT DOC_ID, LINE_ID, EXTRACTED_WORKER, WORKER_KEY,
                MASTER_DISPLAY_NAME, EDIT_DIST
         FROM WORKER_NAME_SUSPECTS
         ORDER BY EDIT_DIST, DOC_ID`
      ),
    ]);
    return NextResponse.json({ workers, suspects });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH: confirm or update a worker entry
export async function PATCH(req: NextRequest) {
  try {
    const body: {
      worker_key: string;
      display_name?: string;
      confirmed?: boolean;
      is_active?: boolean;
      curation_note?: string;
    } = await req.json();

    await runExecute(
      `UPDATE CURATED_WORKERS SET
         DISPLAY_NAME    = COALESCE(?, DISPLAY_NAME),
         CONFIRMED       = COALESCE(?, CONFIRMED),
         IS_ACTIVE       = COALESCE(?, IS_ACTIVE),
         CURATION_NOTE   = COALESCE(?, CURATION_NOTE),
         CURATION_SOURCE = CASE WHEN ? IS NOT NULL THEN 'manual' ELSE CURATION_SOURCE END
       WHERE WORKER_KEY = ?`,
      [
        body.display_name ?? null,
        body.confirmed ?? null,
        body.is_active ?? null,
        body.curation_note ?? null,
        body.display_name ?? null,
        body.worker_key,
      ]
    );
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
