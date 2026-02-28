import { NextRequest, NextResponse } from "next/server";
import { runQuery, runExecute } from "@/lib/snowflake";
import { CuratedProject, ProjectCodeSuspect } from "@/lib/types";

export async function GET() {
  try {
    const [projects, suspects] = await Promise.all([
      runQuery<CuratedProject>(
        `SELECT PROJECT_CODE, PROJECT_NAME, NICKNAME, CONFIRMED, IS_ACTIVE,
                FIRST_SEEN, ADDED_AT, CURATION_SOURCE, CURATION_NOTE, MATCHED_FROM_CODE
         FROM CURATED_PROJECTS
         ORDER BY CONFIRMED ASC, CURATION_SOURCE, PROJECT_CODE`
      ),
      runQuery<ProjectCodeSuspect>(
        `SELECT DOC_ID, LINE_ID, EXTRACTED_CODE, MASTER_CODE, MASTER_NAME, EDIT_DIST
         FROM PROJECT_CODE_SUSPECTS
         ORDER BY EDIT_DIST, DOC_ID`
      ),
    ]);
    return NextResponse.json({ projects, suspects });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH: confirm or update a project entry
export async function PATCH(req: NextRequest) {
  try {
    const body: {
      project_code: string;
      project_name?: string;
      nickname?: string | null;
      confirmed?: boolean;
      is_active?: boolean;
      curation_note?: string;
    } = await req.json();

    await runExecute(
      `UPDATE CURATED_PROJECTS SET
         PROJECT_NAME    = COALESCE(?, PROJECT_NAME),
         NICKNAME        = CASE WHEN ? IS NOT NULL THEN NULLIF(?, '') ELSE NICKNAME END,
         CONFIRMED       = COALESCE(?, CONFIRMED),
         IS_ACTIVE       = COALESCE(?, IS_ACTIVE),
         CURATION_NOTE   = COALESCE(?, CURATION_NOTE),
         CURATION_SOURCE = CASE WHEN ? IS NOT NULL THEN 'manual' ELSE CURATION_SOURCE END
       WHERE PROJECT_CODE = ?`,
      [
        body.project_name ?? null,
        body.nickname !== undefined ? "set" : null,
        body.nickname ?? null,
        body.confirmed ?? null,
        body.is_active ?? null,
        body.curation_note ?? null,
        body.project_name ?? null,
        body.project_code,
      ]
    );
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
