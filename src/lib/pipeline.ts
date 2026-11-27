// The daily loop: chart → survey wave → Prolific → clean → weight → score → guardrails → publish.
import { randomBytes } from "node:crypto";
import { config, sql } from "./db";
import { fetchUkChart, surveyTitleSet, ChartRow, titleFromRow, latestWeeks, CHART_LOOKBACK_WEEKS } from "./netflix";
import { SURVEY_VERSION, decoyFor, RETIRED_DECOYS } from "./questionnaire";
import { createAndPublishStudy, stopStudy, rewardPence, ukFilters, studyStatus, LIVE_STATUSES } from "./prolific";
import { buildSnapshot, RespondentRecord, Snapshot, TitleMeta } from "./scoring";

export function londonDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type Step = { step: string; ok: boolean; detail: string };

// 1. Chart ---------------------------------------------------------------------------------------
export async function refreshChart(rows?: ChartRow[]): Promise<{ week: string; titleIds: string[] }> {
  const db = sql();
  const chart = rows ?? (await fetchUkChart());
  const weeks = latestWeeks(chart, CHART_LOOKBACK_WEEKS);
  const recent = chart.filter((r) => weeks.includes(r.week));
  for (const r of recent) {
    const t = titleFromRow(r);
    await db`insert into titles (id, platform, kind, name, show_title, first_seen)
             values (${t.id}, 'netflix', ${t.kind}, ${t.name}, ${t.showTitle}, ${r.week})
             on conflict (id) do nothing`;
    await db`insert into chart_entries (platform, chart_week, kind, rank, title_id, weeks_in_top10)
             values ('netflix', ${r.week}, ${r.kind}, ${r.rank}, ${t.id}, ${r.weeksInTop10})
             on conflict (platform, chart_week, kind, rank) do update
             set title_id = excluded.title_id, weeks_in_top10 = excluded.weeks_in_top10`;
  }
  const set = surveyTitleSet(chart);
  return { week: set.week, titleIds: [...set.current, ...set.carryOver].map((t) => t.id) };
}

async function titleIdsFromDb(): Promise<{ week: string | null; titleIds: string[] }> {
  const db = sql();
  const weeks = await db`select distinct chart_week from chart_entries where platform='netflix' order by chart_week desc limit ${CHART_LOOKBACK_WEEKS}`;
  if (!weeks.length) return { week: null, titleIds: [] };
  const latest = weeks[0].chart_week as Date;
  const rows = await db`select chart_week, kind, rank, title_id from chart_entries
                        where platform='netflix' and chart_week = any(${weeks.map((w) => w.chart_week)})
                        order by chart_week desc, kind desc, rank`;
  const ids: string[] = [];
  for (const r of rows) if (!ids.includes(r.title_id) && ids.length < Number(process.env.SURVEY_TITLES ?? 20)) ids.push(r.title_id);
  return { week: new Date(latest).toISOString().slice(0, 10), titleIds: ids };
}

// 2. Wave + Prolific -----------------------------------------------------------------------------
export async function ensureWave(date: string, titleIds: string[]): Promise<{ id: number; created: boolean; studyId: string | null; note: string }> {
  const db = sql();
  const existing = await db`select id, prolific_study_id, completion_code, places, status from survey_waves where wave_date = ${date}`;
  if (existing.length && existing[0].prolific_study_id && config.autoPublish()) {
    // A study exists: if it isn't actually live (e.g. it sat as a draft for lack of funds), try to publish it again
    const id = existing[0].prolific_study_id as string;
    let status = await studyStatus(id).catch((e) => `error: ${(e as Error).message}`);
    if (!LIVE_STATUSES.includes(status) && !["COMPLETED", "AWAITING REVIEW", "PAUSED"].includes(status)) {
      await publishExisting(id).catch(() => {});
      status = await studyStatus(id).catch(() => status);
    }
    const live = LIVE_STATUSES.includes(status);
    await db`update survey_waves set status = ${live ? "active" : `not live: ${status}`.slice(0, 200)} where id = ${existing[0].id}`;
    return { id: existing[0].id, created: false, studyId: id, note: `study ${status}` };
  }
  if (existing.length && !config.autoPublish())
    return { id: existing[0].id, created: false, studyId: existing[0].prolific_study_id, note: "wave already exists" };

  // Resolve the UK filter before creating anything, so a lookup failure never leaves a half-made wave
  const filters = config.autoPublish() ? await ukFilters() : [];
  let wave: { id: number; completion_code: string; places: number };
  if (existing.length) {
    // Today's wave was made while publishing was off: publish its study now rather than waiting for tomorrow
    wave = existing[0] as typeof wave;
  } else {
    const code = randomBytes(4).toString("hex").toUpperCase();
    [wave] = (await db`insert into survey_waves (wave_date, survey_version, title_ids, decoy, completion_code, places, status)
                       values (${date}, ${SURVEY_VERSION}, ${titleIds}, ${decoyFor(date)}, ${code}, ${config.dailyCompletes()}, 'draft')
                       returning id, completion_code, places`) as unknown as (typeof wave)[];
  }
  const code = wave.completion_code;
  const places = config.dailyCompletes();

  if (!config.autoPublish()) return { id: wave.id, created: true, studyId: null, note: "PROLIFIC_AUTO_PUBLISH is off — wave created, no study published" };

  const minutes = config.surveyMinutes();
  const study = await createAndPublishStudy({
    name: "Quick survey: what you've been watching on Netflix",
    internalName: `streaming-machine netflix ${date}`,
    description:
      "Tell us which shows and films you've watched recently on Netflix and what you thought of them. " +
      "About 8 minutes. You need a Netflix account you can watch at home.",
    externalUrl: `${config.appUrl()}/survey?wave=${wave.id}`,
    places,
    minutes,
    rewardPence: rewardPence(minutes, config.hourlyGbp()),
    completionCode: code,
    filters,
    projectId: process.env.PROLIFIC_PROJECT_ID || undefined,
  });
  const live = LIVE_STATUSES.includes(study.status);
  const waveStatus = live ? "active" : `not live: ${study.status}${study.error ? ` — ${study.error}` : ""}`.slice(0, 200);
  await db`update survey_waves set prolific_study_id = ${study.id}, status = ${waveStatus}, places = ${places} where id = ${wave.id}`;
  if (!live) throw new Error(`Prolific study ${study.id} was created but is ${waveStatus}. Check the Prolific balance.`);

  // Stop studies from waves older than 2 days so spend stays on the current title set
  const stale = await db`select id, prolific_study_id from survey_waves
                         where status='active' and wave_date < ${addDays(date, -1)} and prolific_study_id is not null`;
  for (const s of stale) {
    try { await stopStudy(s.prolific_study_id); await db`update survey_waves set status='stopped' where id=${s.id}`; }
    catch (e) { console.error("stopStudy failed", s.prolific_study_id, e); }
  }
  return { id: wave.id, created: true, studyId: study.id, note: `published ${places} places` };
}

async function publishExisting(id: string) {
  const res = await fetch(`https://api.prolific.com/api/v1/studies/${id}/transition/`, {
    method: "POST",
    headers: { Authorization: `Token ${process.env.PROLIFIC_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "PUBLISH" }),
  });
  if (!res.ok) throw new Error(`publish ${res.status}`);
}

// 3. Load responses --------------------------------------------------------------------------------
export async function loadRespondents(fromIso: string, toIsoExclusive: string): Promise<RespondentRecord[]> {
  const db = sql();
  const rows = await db`
    select r.id, r.completed_at, coalesce(r.duration_sec,0) as duration_sec, r.age, r.region, r.gender, r.social_grade,
           coalesce(r.household,'{}') as household, coalesce(r.genres,'{}') as genres, r.hours, r.attitudes,
           coalesce(r.attention_ok,false) as attention_ok, coalesce(r.decoy_claimed,false) and not coalesce((select w.decoy from survey_waves w where w.id = r.wave_id) = any(${RETIRED_DECOYS}),false) as decoy_claimed,
           coalesce(r.straightliner,false) as straightliner,
           coalesce((select json_object_agg(v.title_id, json_build_object('status',v.status,'plan',v.plan_to_watch,'heardVia',v.heard_via))
                     from viewing v where v.respondent_id = r.id), '{}'::json) as viewing,
           coalesce((select json_agg(json_build_object('titleId',g.title_id,'rating',g.rating,'recommend',g.recommend,
                     'attributes',g.attributes,'occasions',coalesce(g.occasions,'{}'),'kidSafe',g.kid_safe))
                     from ratings g where g.respondent_id = r.id), '[]'::json) as ratings
    from respondents r
    where r.status = 'complete' and r.completed_at >= ${fromIso} and r.completed_at < ${toIsoExclusive}`;
  return rows.map((r) => ({
    id: r.id, completedAt: new Date(r.completed_at).toISOString(), durationSec: Number(r.duration_sec), age: Number(r.age),
    region: r.region, gender: r.gender, grade: r.social_grade, household: r.household, genres: r.genres, hours: r.hours ?? null, attitudes: r.attitudes ?? null,
    attentionOk: r.attention_ok, decoyClaimed: r.decoy_claimed, straightliner: r.straightliner,
    viewing: r.viewing, ratings: r.ratings,
  }));
}

// 4. Guardrails ----------------------------------------------------------------------------------
export function guardrails(s: Snapshot, prev: Snapshot | null) {
  const issues: string[] = [];
  if (s.sample.valid < config.minWeeklyValid())
    issues.push(`Only ${s.sample.valid} valid completes in the 7-day window (minimum ${config.minWeeklyValid()})`);
  const exRate = s.sample.completes ? s.sample.excluded / s.sample.completes : 0;
  if (exRate > config.maxExclusionRate())
    issues.push(`Quality exclusions at ${(exRate * 100).toFixed(0)}% (limit ${(config.maxExclusionRate() * 100).toFixed(0)}%)`);
  if (prev) {
    const prevMap = new Map(prev.titles.map((t) => [t.id, t]));
    for (const t of s.titles) {
      const p = prevMap.get(t.id);
      if (t.status === "scored" && p?.status === "scored" && t.viewerScore != null && p.viewerScore != null &&
          Math.abs(t.viewerScore - p.viewerScore) > config.maxScoreSwing())
        issues.push(`${t.name} moved ${(t.viewerScore - p.viewerScore).toFixed(1)} points in a day`);
    }
  }
  return { ok: issues.length === 0, issues };
}

async function alert(message: string) {
  console.error("[ALERT]", message);
  const url = process.env.ALERT_WEBHOOK_URL; // e.g. a Slack incoming webhook
  if (url) await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: message }) }).catch(() => {});
}

export async function latestPublishedSnapshot(): Promise<Snapshot | null> {
  const db = sql();
  const rows = await db`select data from snapshots where published order by snapshot_date desc, id desc limit 1`;
  return rows.length ? (rows[0].data as Snapshot) : null;
}

// 5. Score + publish -------------------------------------------------------------------------------
export async function computeSnapshot(date: string, titleIds: string[], chartWeek: string | null,
  thresholds?: { scored: number; early: number }) {
  const db = sql();
  const to = addDays(date, 1);            // include today so far
  const from = addDays(to, -7);
  const prevFrom = addDays(from, -7);
  const [current, previous] = await Promise.all([loadRespondents(from, to), loadRespondents(prevFrom, from)]);

  const meta = await db`select t.id, t.name, t.kind,
                          (select min(rank) from chart_entries c where c.title_id=t.id and c.chart_week=${chartWeek}) as chart_rank
                        from titles t where t.id = any(${titleIds})`;
  const order = new Map(titleIds.map((id, i) => [id, i]));
  const titles: TitleMeta[] = meta
    .map((m) => ({ id: m.id, name: m.name, kind: m.kind, chartRank: m.chart_rank ?? null }))
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!);

  const prev = await latestPublishedSnapshot();
  const snapshot = buildSnapshot({
    snapshotDate: date, chartWeek, window: { from, to: date }, titles, current, previous,
    previousScores: prev ? new Map(prev.titles.map((t) => [t.id, t.viewerScore])) : undefined,
    thresholds,
  });
  return { snapshot, prev };
}

/** Latest wave's titles and chart week, for previews outside the daily run. */
export async function currentTitleSet(): Promise<{ titleIds: string[]; week: string | null }> {
  const db = sql();
  const [w] = await db`select title_ids from survey_waves order by wave_date desc limit 1`;
  const [c] = await db`select max(chart_week) as week from chart_entries where platform='netflix'`;
  return { titleIds: w?.title_ids ?? [], week: c?.week ? new Date(c.week).toISOString().slice(0, 10) : null };
}

export async function computeAndPublish(date: string, titleIds: string[], chartWeek: string | null) {
  const db = sql();
  const { snapshot, prev } = await computeSnapshot(date, titleIds, chartWeek);
  const guard = guardrails(snapshot, prev);
  await db`insert into snapshots (snapshot_date, published, guardrails, data)
           values (${date}, ${guard.ok}, ${db.json(guard as never)}, ${db.json(snapshot as never)})`;
  if (!guard.ok) await alert(`Streaming Machine: publish held for ${date}; dashboard keeps the last good data.\n- ${guard.issues.join("\n- ")}`);
  return { published: guard.ok, issues: guard.issues, sample: snapshot.sample };
}

// Orchestrator ------------------------------------------------------------------------------------
export async function runDaily(date = londonDate()) {
  const steps: Step[] = [];
  let titleIds: string[] = [];
  let week: string | null = null;

  try {
    const r = await refreshChart();
    titleIds = r.titleIds; week = r.week;
    steps.push({ step: "chart", ok: true, detail: `UK chart week ending ${r.week}: ${r.titleIds.length} titles` });
  } catch (e) {
    const fallback = await titleIdsFromDb();
    titleIds = fallback.titleIds; week = fallback.week;
    steps.push({ step: "chart", ok: false, detail: `Feed failed (${(e as Error).message}); reusing chart ${week}` });
    await alert(`Streaming Machine: Netflix chart feed failed — reusing week ${week}. ${(e as Error).message}`);
  }
  if (!titleIds.length) return { date, steps, stopped: "No titles available" };

  try {
    const w = await ensureWave(date, titleIds);
    steps.push({ step: "wave", ok: true, detail: `wave ${w.id}: ${w.note}` });
  } catch (e) {
    steps.push({ step: "wave", ok: false, detail: (e as Error).message });
    await alert(`Streaming Machine: could not create today's Prolific study. ${(e as Error).message}`);
  }

  try {
    const p = await computeAndPublish(date, titleIds, week);
    steps.push({ step: "publish", ok: p.published, detail: p.published ? `published (${p.sample.valid} valid)` : `held: ${p.issues.join("; ")}` });
  } catch (e) {
    steps.push({ step: "publish", ok: false, detail: (e as Error).message });
    await alert(`Streaming Machine: scoring failed. ${(e as Error).message}`);
  }
  return { date, steps };
}
