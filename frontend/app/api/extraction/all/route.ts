import { NextResponse } from "next/server";
import { runQuery } from "@/lib/snowflake";

export async function POST() {
  const t0 = Date.now();
  console.log("[extraction/all] POST started");

  try {
    const rows = await runQuery<{ EXTRACT_ALL_MULTIMODAL: string }>(
      `CALL EXTRACT_ALL_MULTIMODAL()`
    );
    const message = rows[0] ? Object.values(rows[0])[0] as string : "No result";
    console.log(`[extraction/all] OK in ${Date.now() - t0}ms — ${message}`);
    return NextResponse.json({ success: true, message });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[extraction/all] FAILED in ${Date.now() - t0}ms — ${message}`);
    if (err instanceof Error && err.stack) {
      console.error("[extraction/all] stack:", err.stack);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
