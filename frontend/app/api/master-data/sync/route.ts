import { NextResponse } from "next/server";
import { runQuery } from "@/lib/snowflake";

export async function POST() {
  try {
    const rows = await runQuery<{ SYNC_CURATED_MASTER: string }>(
      `CALL SYNC_CURATED_MASTER()`
    );
    const message = rows[0]
      ? Object.values(rows[0])[0] as string
      : "No result";
    return NextResponse.json({ success: true, message });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
