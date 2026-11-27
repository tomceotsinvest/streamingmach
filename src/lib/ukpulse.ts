// UK Pulse: daily tracker of agreement with fixed statements, weighted to UK adults and 2024 vote.
import { rake, UK_ADULT_TARGETS, gradeGroup, Targets } from "./weighting";
import { ageBand, UK_KEYS, UkKey, GE2024_SHARES, UK_CHECK, UK_MIN_SECONDS } from "./questionnaire";
import { sql } from "./db";

export type PulseRow = {
  id: string; date: string; age: number; gender: string | null; region: string | null; grade: string | null;
  vote: string | null; uk: Record<string, number>;
};

export type Reading = { agree: number; disagree: number; net: number };
export type PulseData = {
  generatedAt: string;
  window: number;              // rolling window in days
  days: string[];              // one entry per day with a reading
  series: Record<UkKey, number[]>; // % agree (0-100) per day, aligned to days
  latest: null | {
    date: string; n: number; effectiveN: number; earliest: string;
    values: Record<UkKey, Reading>;
    change: Record<UkKey, number | null>; // points vs 28 days earlier, when available
  };
  groups: { labels: string[]; n: number[]; values: Record<UkKey, (number | null)[]> } | null;
  totalN: number;
};

export const PULSE_WINDOW = 7;
const MIN_WINDOW_N = 30;
const GROUP_DAYS = 28;

const TARGETS: Targets = { ...UK_ADULT_TARGETS, vote: GE2024_SHARES };

function addDays(d: string, n: number) {
  const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
}

function weigh(rows: PulseRow[]) {
  return rake(rows.map((r) => ({
    id: r.id,
    cells: { ageBand: ageBand(r.age), gender: r.gender, region: r.region, grade: gradeGroup(r.grade), vote: r.vote },
  })), TARGETS);
}

function readings(rows: PulseRow[], w: Map<string, number>): Record<UkKey, Reading> {
  const out = {} as Record<UkKey, Reading>;
  for (const k of UK_KEYS) {
    let tot = 0, ag = 0, dis = 0;
    for (const r of rows) {
      const v = r.uk[k]; if (!v) continue;
      const wt = w.get(r.id) ?? 1; tot += wt;
      if (v >= 4) ag += wt; else if (v <= 2) dis += wt;
    }
    const agree = tot ? (100 * ag) / tot : 0, disagree = tot ? (100 * dis) / tot : 0;
    out[k] = { agree, disagree, net: agree - disagree };
  }
  return out;
}

export function computePulse(all: PulseRow[]): PulseData {
  const rows = all.filter((r) => r.age >= 18);
  const base: PulseData = {
    generatedAt: new Date().toISOString(), window: PULSE_WINDOW, days: [],
    series: Object.fromEntries(UK_KEYS.map((k) => [k, []])) as unknown as Record<UkKey, number[]>,
    latest: null, groups: null, totalN: rows.length,
  };
  if (!rows.length) return base;
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const first = dates[0], last = dates[dates.length - 1];
  const byDay = new Map<string, Record<UkKey, Reading>>();
  let lastWin: { rows: PulseRow[]; eff: number } | null = null;

  for (let d = first; d <= last; d = addDays(d, 1)) {
    const from = addDays(d, -(PULSE_WINDOW - 1));
    const win = rows.filter((r) => r.date >= from && r.date <= d);
    if (win.length < MIN_WINDOW_N) continue;
    const wr = weigh(win);
    const vals = readings(win, wr.weights);
    byDay.set(d, vals);
    base.days.push(d);
    for (const k of UK_KEYS) base.series[k].push(Math.round(vals[k].agree * 10) / 10);
    lastWin = { rows: win, eff: wr.effectiveN };
  }

  if (base.days.length && lastWin) {
    const d = base.days[base.days.length - 1];
    const prev = byDay.get(addDays(d, -28));
    const values = byDay.get(d)!;
    base.latest = {
      date: d, n: lastWin.rows.length, effectiveN: Math.round(lastWin.eff), earliest: first, values,
      change: Object.fromEntries(UK_KEYS.map((k) => [k, prev ? values[k].agree - prev[k].agree : null])) as Record<UkKey, number | null>,
    };
  }

  // Breakdown over the last 28 days (more sample for subgroups)
  const recent = rows.filter((r) => r.date > addDays(last, -GROUP_DAYS));
  if (recent.length >= MIN_WINDOW_N) {
    const w = weigh(recent).weights;
    const defs: [string, (r: PulseRow) => boolean][] = [
      ["All adults", () => true],
      ["18–34", (r) => r.age < 35], ["35–54", (r) => r.age >= 35 && r.age < 55], ["55+", (r) => r.age >= 55],
      ["Men", (r) => r.gender === "Man"], ["Women", (r) => r.gender === "Woman"],
      ["London", (r) => r.region === "London"], ["Rest of UK", (r) => !!r.region && r.region !== "London"],
    ];
    const labels: string[] = [], n: number[] = [];
    const values = Object.fromEntries(UK_KEYS.map((k) => [k, [] as (number | null)[]])) as Record<UkKey, (number | null)[]>;
    for (const [label, f] of defs) {
      const sub = recent.filter(f);
      labels.push(label); n.push(sub.length);
      const v = sub.length >= 40 ? readings(sub, w) : null;
      for (const k of UK_KEYS) values[k].push(v ? Math.round(v[k].agree) : null);
    }
    base.groups = { labels, n, values };
  }
  return base;
}

export async function loadPulseRows(): Promise<PulseRow[]> {
  const db = sql();
  const rs = await db`
    select id::text, to_char(completed_at at time zone 'Europe/London', 'YYYY-MM-DD') as date,
      age, gender, region, social_grade, past_vote, uk
    from respondents
    where uk is not null and uk_check = ${UK_CHECK.answer} and coalesce(uk_seconds, 0) >= ${UK_MIN_SECONDS}
      and age >= 18
    order by completed_at`;
  return rs.map((r) => ({
    id: r.id, date: r.date, age: r.age, gender: r.gender, region: r.region, grade: r.social_grade, vote: r.past_vote,
    uk: r.uk as Record<string, number>,
  }));
}

// Clearly-labelled synthetic data for local previews without a database
export function demoPulseRows(days = 45): PulseRow[] {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const regions = Object.keys(UK_ADULT_TARGETS.region), votes = [...Object.keys(GE2024_SHARES), "Didn't vote"];
  const base: Record<UkKey, number> = { direction: 2.4, finances: 2.8, costOfLiving: 4.0, nhs: 2.7, news: 2.5, ai: 2.9, children: 3.2, proud: 3.4, localArea: 2.6, safe: 3.6 };
  const rows: PulseRow[] = [];
  const start = addDays(new Date().toISOString().slice(0, 10), -days);
  for (let d = 0; d < days; d++) {
    const date = addDays(start, d);
    for (let i = 0; i < 110; i++) {
      const age = 18 + Math.floor(rnd() * 62);
      const uk = Object.fromEntries(UK_KEYS.map((k) => {
        const drift = k === "direction" ? -d * 0.008 : k === "ai" ? d * 0.006 : 0;
        const tilt = k === "ai" ? (age < 35 ? 0.5 : -0.3) : k === "proud" ? (age > 55 ? 0.5 : -0.2) : 0;
        return [k, Math.max(1, Math.min(5, Math.round(base[k] + drift + tilt + (rnd() - 0.5) * 3.6)))];
      }));
      rows.push({ id: `${d}-${i}`, date, age, gender: rnd() < 0.5 ? "Man" : "Woman", region: regions[Math.floor(rnd() * regions.length)],
        grade: ["AB", "C1", "C2", "DE"][Math.floor(rnd() * 4)], vote: votes[Math.floor(rnd() * votes.length)], uk });
    }
  }
  return rows;
}
