import { RETIRED_DECOYS } from "@/lib/questionnaire";
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
    // Aggregate quality breakdown (counts only, no respondent-level data)
    const [q] = await db`with c as (
        select r.id, r.duration_sec, r.attention_ok, (r.decoy_claimed and not coalesce(w.decoy = any(${RETIRED_DECOYS}), false)) as decoy_claimed, r.straightliner, w.wave_date,
          (select count(*) from ratings g where g.respondent_id=r.id) as dives
        from respondents r left join survey_waves w on w.id=r.wave_id
        where r.status='complete' and r.completed_at > now() - interval '7 days'),
      m as (select percentile_cont(0.5) within group (order by duration_sec) as med from c),
      f as (select c.*, (c.duration_sec < m.med*0.4) as speeder from c, m)
      select count(*)::int as n,
        count(*) filter (where not attention_ok)::int as attention_fail,
        count(*) filter (where decoy_claimed)::int as decoy,
        count(*) filter (where straightliner)::int as straightline,
        count(*) filter (where speeder)::int as speeder,
        count(*) filter (where decoy_claimed or not attention_ok or straightliner or speeder)::int as any_flag,
        count(*) filter (where not attention_ok and not decoy_claimed and not straightliner and not speeder)::int as only_attention,
        count(*) filter (where decoy_claimed and attention_ok and not straightliner and not speeder)::int as only_decoy,
        count(*) filter (where straightliner and attention_ok and not decoy_claimed and not speeder)::int as only_straightline,
        count(*) filter (where speeder and attention_ok and not decoy_claimed and not straightliner)::int as only_speeder,
        count(*) filter (where straightliner and dives=1)::int as straightline_1_dive,
        count(*) filter (where straightliner and dives>=2)::int as straightline_2plus,
        (select round(med) from m) as median_sec,
        count(*) filter (where duration_sec < 120)::int as under_2min,
        count(*) filter (where duration_sec between 120 and 179)::int as d2_3min,
        (select json_object_agg(wave_date, k) from (select wave_date::text, count(*) filter (where decoy_claimed)::int as k from f group by 1) x) as decoy_by_wave
      from f`;
    const flatVals = await db`select a.v as value, count(*)::int as n from ratings g join respondents r on r.id=g.respondent_id,
        lateral (select distinct value::text as v from jsonb_each(g.attributes)) a
      where r.straightliner and r.completed_at > now() - interval '7 days' group by 1 order by 1`;
    return NextResponse.json({ ok: true, db: shape, tables: tables.map((t) => t.table_name), waves, last7days: { ...resp, ...rated }, quality: { ...q, straightline_values: flatVals } });
  } catch (e) {
    const err = e as { code?: string; message?: string };
    const msg = (err.message ?? "").replace(/postgres(ql)?:\/\/[^\s]+/g, "[url]");
    return NextResponse.json({ ok: false, db: shape, error: { code: err.code ?? null, message: msg.slice(0, 300) } }, { status: 500 });
  }
}
