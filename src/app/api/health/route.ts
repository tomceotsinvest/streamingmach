import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Reports whether the database is reachable and set up. Never returns the connection string or password.
export async function GET() {
  const url = process.env.DATABASE_URL ?? "";
  let shape: Record<string, unknown> = { set: !!url };
  try {
    const u = new URL(url);
    shape = {
      set: true,
      scheme: u.protocol.replace(":", ""),
      host: u.hostname.replace(/^[^.]+/, (m) => (m.length > 4 ? m.slice(0, 4) + "…" : m)),
      port: u.port || "(default)",
      user: u.username.replace(/\.(.{4}).*$/, ".$1…"),
      passwordPlaceholderLeft: /YOUR-PASSWORD|\[|\]/i.test(decodeURIComponent(u.password)),
      database: u.pathname.slice(1),
    };
  } catch { if (url) shape = { set: true, parseable: false }; }
  try {
    const db = sql();
    const tables = await db`select table_name from information_schema.tables where table_schema='public' order by 1`;
    const waves = await db`select id, wave_date, status, array_length(title_ids,1) as titles, prolific_study_id is not null as has_study from survey_waves order by id desc limit 3`;
    return NextResponse.json({ ok: true, db: shape, tables: tables.map((t) => t.table_name), waves });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const msg = (err.message ?? "").replace(/postgres(ql)?:\/\/[^\s]+/g, "[url]");
    return NextResponse.json({ ok: false, db: shape, error: { code: err.code ?? null, message: msg.slice(0, 300) } }, { status: 500 });
  }
}
