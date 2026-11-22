import { NextResponse } from "next/server";
import { sql, dbUrl } from "@/lib/db";

export const dynamic = "force-dynamic";

// Reports whether the database is reachable and set up. Never returns the connection string or password.
export async function GET() {
  const url = dbUrl() ?? "";
  const source = process.env.DATABASE_URL ? "DATABASE_URL" : process.env.POSTGRES_URL ? "POSTGRES_URL" : null;
  let shape: Record<string, unknown> = { set: !!url, source };
  try {
    const u = new URL(url);
    shape = {
      set: true,
      source,
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
    const waves = await db`select w.id, w.wave_date, w.status, array_length(w.title_ids,1) as titles, w.prolific_study_id is not null as has_study, w.places,
        (select count(*)::int from respondents r where r.wave_id=w.id and r.status='complete') as completes,
        (select count(*)::int from respondents r where r.wave_id=w.id and r.status='screened') as screened
      from survey_waves w order by w.id desc limit 5`;
    const [resp] = await db`select
        count(*) filter (where status='complete')::int as completes,
        count(*) filter (where status='screened')::int as screened_out,
        count(*) filter (where status='complete' and (decoy_claimed or not attention_ok or straightliner))::int as flagged,
        percentile_cont(0.5) within group (order by duration_sec) filter (where status='complete') as median_sec,
        max(completed_at) as last_at
      from respondents where completed_at > now() - interval '7 days'`;
    const [rated] = await db`select count(*)::int as ratings, count(distinct title_id)::int as titles_rated from ratings g
                             join respondents r on r.id=g.respondent_id where r.completed_at > now() - interval '7 days'`;
    return NextResponse.json({ ok: true, db: shape, tables: tables.map((t) => t.table_name), waves, last7days: { ...resp, ...rated } });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const msg = (err.message ?? "").replace(/postgres(ql)?:\/\/[^\s]+/g, "[url]");
    return NextResponse.json({ ok: false, db: shape, error: { code: err.code ?? null, message: msg.slice(0, 300) } }, { status: 500 });
  }
}
