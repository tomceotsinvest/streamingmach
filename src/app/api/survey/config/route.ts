import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { addDays, londonDate } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

// What the survey page needs for one wave: the titles, the decoy, and current rater counts (for allocation).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const waveId = Number(url.searchParams.get("wave"));
  const pid = url.searchParams.get("pid");
  if (!waveId) return NextResponse.json({ error: "missing wave" }, { status: 400 });
  const db = sql();
  const [wave] = await db`select id, wave_date, title_ids, decoy from survey_waves where id = ${waveId}`;
  if (!wave) return NextResponse.json({ error: "unknown wave" }, { status: 404 });

  // One response per person per 7 days keeps heavy survey-takers from dominating
  if (pid) {
    const recent = await db`select 1 from respondents where prolific_pid = ${pid} and status='complete'
                            and completed_at > now() - interval '7 days' limit 1`;
    if (recent.length) return NextResponse.json({ blocked: true });
  }

  const titles = await db`select id, name, kind from titles where id = any(${wave.title_ids})`;
  const order = new Map((wave.title_ids as string[]).map((id, i) => [id, i]));
  titles.sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  const since = addDays(londonDate(), -6);
  const counts = await db`select g.title_id, count(*)::int as n from ratings g join respondents r on r.id = g.respondent_id
                          where r.completed_at >= ${since} and g.title_id = any(${wave.title_ids}) group by g.title_id`;
  return NextResponse.json({
    waveId: wave.id,
    titles: titles.map((t) => ({ id: t.id, name: t.name, kind: t.kind })),
    decoy: wave.decoy,
    raterCounts: Object.fromEntries(counts.map((c) => [c.title_id, c.n])),
  });
}
