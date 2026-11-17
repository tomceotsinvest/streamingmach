// Generates a DEMO snapshot from synthetic respondents so the dashboard can be previewed before any fieldwork.
// Titles are fictional on purpose: fake scores must never be shown against real shows.
// npm run demo  → writes public/demo-snapshot.json
import { writeFileSync } from "node:fs";
import { buildSnapshot, RespondentRecord, TitleMeta, RatingRecord } from "../src/lib/scoring";
import { ATTRIBUTE_KEYS, AttributeKey, OCCASION_KEYS, OccasionKey, REGIONS, GENRES, ViewStatus } from "../src/lib/questionnaire";
import { allocateDeepDives } from "../src/lib/allocation";

let seed = 42;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const norm = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return u - 3; };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

type Spec = { name: string; kind: "tv" | "film"; q: number; reach: number; prevReach: number; young: number; attrs: Partial<Record<AttributeKey, number>>; occ: OccasionKey[]; kid: number };
const S: Spec[] = [
  { name: "The Lantern Keepers: Season 2", kind: "tv", q: 8.3, reach: .34, prevReach: .12, young: .3, attrs: { gripping: 4.5, tense: 4, bingeable: 4.6, acting: 4.2 }, occ: ["binge", "edge"], kid: .1 },
  { name: "Stillwater Bay", kind: "tv", q: 7.6, reach: .28, prevReach: .30, young: -.2, attrs: { gripping: 4, acting: 4.1, ending: 3.6 }, occ: ["unwind", "binge"], kid: .15 },
  { name: "Wrong Number, Right Person", kind: "film", q: 6.9, reach: .22, prevReach: .05, young: .4, attrs: { funny: 4.2, easy: 4.4, moving: 3.4 }, occ: ["date", "laugh", "unwind"], kid: .35 },
  { name: "Glasshouse", kind: "tv", q: 7.2, reach: .19, prevReach: .21, young: .1, attrs: { thoughtful: 4.3, tense: 3.8, stunning: 4.2 }, occ: ["edge"], kid: .05 },
  { name: "The Allotment", kind: "tv", q: 7.9, reach: .15, prevReach: .14, young: -.6, attrs: { funny: 4.4, easy: 4.5, moving: 3.6 }, occ: ["laugh", "unwind", "family"], kid: .7 },
  { name: "Red Meridian", kind: "film", q: 6.4, reach: .24, prevReach: .26, young: .2, attrs: { gripping: 3.8, tense: 3.6, stunning: 4.1 }, occ: ["edge"], kid: .1 },
  { name: "Inside the Collapse", kind: "tv", q: 7.4, reach: .17, prevReach: .03, young: 0, attrs: { thoughtful: 4.6, gripping: 4, moving: 3.5 }, occ: ["binge"], kid: .2 },
  { name: "Tiny Kingdoms", kind: "tv", q: 8.6, reach: .11, prevReach: .10, young: -.1, attrs: { stunning: 4.8, moving: 4, easy: 4.2, thoughtful: 4 }, occ: ["family", "unwind"], kid: .95 },
  { name: "Love on Loop: Season 3", kind: "tv", q: 5.9, reach: .21, prevReach: .25, young: .7, attrs: { easy: 4.5, funny: 3.5, bingeable: 4 }, occ: ["background", "unwind"], kid: .2 },
  { name: "The Quiet Hours", kind: "film", q: 7.0, reach: .13, prevReach: .02, young: -.3, attrs: { moving: 4.5, acting: 4.4, ending: 3.9 }, occ: ["date"], kid: .3 },
  { name: "Night Shift Detective", kind: "tv", q: 7.1, reach: .18, prevReach: .19, young: -.4, attrs: { gripping: 4.1, tense: 3.5, bingeable: 4 }, occ: ["binge", "edge"], kid: .1 },
  { name: "Jumpscare Island", kind: "film", q: 5.6, reach: .16, prevReach: .18, young: .6, attrs: { tense: 4.6, funny: 2.8 }, occ: ["edge"], kid: .05 },
  { name: "Brothers in Arms: The Reunion", kind: "film", q: 6.6, reach: .14, prevReach: .16, young: -.5, attrs: { gripping: 3.9, moving: 3.7 }, occ: ["edge"], kid: .15 },
  { name: "Puzzle Street", kind: "film", q: 7.7, reach: .12, prevReach: .13, young: .1, attrs: { funny: 4.1, easy: 4.3, moving: 3.6 }, occ: ["family", "laugh"], kid: .9 },
  { name: "The Heist Season", kind: "film", q: 6.8, reach: .20, prevReach: .23, young: .3, attrs: { gripping: 4, funny: 3.4, easy: 3.9 }, occ: ["date", "unwind"], kid: .3 },
  { name: "Cold Harbour: Season 1", kind: "tv", q: 7.5, reach: .10, prevReach: .11, young: -.3, attrs: { tense: 4.2, gripping: 4.3, acting: 4.1 }, occ: ["edge", "binge"], kid: .05 },
  { name: "Saturday Kitchen Wars", kind: "tv", q: 6.3, reach: .09, prevReach: .10, young: 0, attrs: { easy: 4.6, funny: 3.6 }, occ: ["background", "family"], kid: .8 },
  { name: "Starfall", kind: "film", q: 6.1, reach: .11, prevReach: .12, young: .5, attrs: { stunning: 4.5, gripping: 3.5 }, occ: ["family", "edge"], kid: .6 },
  { name: "Margins", kind: "film", q: 7.3, reach: .06, prevReach: .07, young: -.2, attrs: { thoughtful: 4.4, acting: 4.3, moving: 4 }, occ: ["date"], kid: .1 },
  { name: "Signal Lost", kind: "tv", q: 6.7, reach: .07, prevReach: .02, young: .2, attrs: { thoughtful: 3.9, tense: 3.9, gripping: 3.8 }, occ: ["binge"], kid: .1 },
];
const titles: TitleMeta[] = S.map((s, i) => ({
  id: `${s.kind}-demo-${i}`, name: s.name, kind: s.kind, chartRank: (i % 10) + 1,
}));

function respondent(id: string, day: string, reachKey: "reach" | "prevReach", counts: Record<string, number>): RespondentRecord {
  // Opt-in skew: younger, more London/South East, more ABC1 — weighting should correct this
  const ageRoll = rnd();
  const age = ageRoll < .22 ? 18 + Math.floor(rnd() * 7) : ageRoll < .48 ? 25 + Math.floor(rnd() * 10) : ageRoll < .68 ? 35 + Math.floor(rnd() * 10)
    : ageRoll < .84 ? 45 + Math.floor(rnd() * 10) : ageRoll < .94 ? 55 + Math.floor(rnd() * 10) : 65 + Math.floor(rnd() * 15);
  const youth = clamp((40 - age) / 20, -1, 1);
  const gender = rnd() < .58 ? "Woman" : rnd() < .97 ? "Man" : "Prefer not to say";
  const kids = rnd() < .3;
  const viewing: RespondentRecord["viewing"] = {};
  const status: Record<string, ViewStatus> = {};
  S.forEach((s, i) => {
    const p = clamp(s[reachKey] * (1 + 0.6 * s.young * youth), 0.005, 0.9);
    const u = rnd();
    const st: ViewStatus = u < p ? (rnd() < .55 ? "finished" : rnd() < .6 ? "watching" : "stopped")
      : u < p + 0.35 ? "heard" : "never";
    status[titles[i].id] = st;
    viewing[titles[i].id] = { status: st, plan: st === "heard" && rnd() < s[reachKey] * 1.6,
      heardVia: st === "watching" || st === "heard" ? pick(["Friend or family", "Social media", "Netflix recommended it", "Netflix recommended it", "Don't remember"]) : null };
  });
  const deep = allocateDeepDives(status, counts, { random: rnd });
  const ratings: RatingRecord[] = deep.map((tid) => {
    counts[tid] = (counts[tid] ?? 0) + 1;
    const s = S[titles.findIndex((t) => t.id === tid)];
    const affinity = s.young * youth * 0.9 + (kids && s.kid > .6 ? 0.5 : 0);
    const r = Math.round(clamp(s.q + affinity + norm() * 1.1, 1, 10));
    const rec = Math.round(clamp(r - 0.5 + norm() * 1.2, 0, 10));
    const attributes = Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, Math.round(clamp((s.attrs[k] ?? 2.6) + norm() * 0.7, 1, 5))]));
    const occasions = [...new Set([...s.occ.filter(() => rnd() < .6), pick(OCCASION_KEYS)])].slice(0, 3) as OccasionKey[];
    const kidSafe = rnd() < s.kid ? "yes" : rnd() < .5 ? "older" : "no";
    return { titleId: tid, rating: r, recommend: rec, attributes, occasions, kidSafe };
  });
  const gr = rnd();
  return {
    id, completedAt: `${day}T${String(8 + Math.floor(rnd() * 14)).padStart(2, "0")}:00:00Z`, durationSec: Math.round(420 + norm() * 120),
    age, region: rnd() < .2 ? "London" : rnd() < .2 ? "South East" : pick(REGIONS), gender,
    grade: gr < .3 ? "AB" : gr < .65 ? "C1" : gr < .85 ? "C2" : "DE",
    household: [rnd() < .6 ? "Partner" : "Alone", ...(kids ? ["Children under 16"] : [])],
    genres: [...new Set([pick(GENRES), pick(GENRES), pick(GENRES)])],
    attentionOk: rnd() > .03, decoyClaimed: rnd() < .04, straightliner: rnd() < .02,
    viewing, ratings,
  };
}

const days = (end: string, n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date(`${end}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - i); return d.toISOString().slice(0, 10);
});
const today = new Date().toISOString().slice(0, 10);
const curCounts: Record<string, number> = {}, prevCounts: Record<string, number> = {};
const current = days(today, 7).flatMap((d, di) => Array.from({ length: 200 }, (_, i) => respondent(`c${di}-${i}`, d, "reach", curCounts)));
const prevEnd = days(today, 8)[7];
const previous = days(prevEnd, 7).flatMap((d, di) => Array.from({ length: 200 }, (_, i) => respondent(`p${di}-${i}`, d, "prevReach", prevCounts)));

const snap = buildSnapshot({ snapshotDate: today, chartWeek: null, window: { from: days(today, 7)[6], to: today }, titles, current, previous });
snap.demo = true;
writeFileSync(new URL("../public/demo-snapshot.json", import.meta.url), JSON.stringify(snap));
const scored = snap.titles.filter((t) => t.viewerScore != null).length;
console.log(`Demo snapshot: ${snap.sample.completes} completes, ${snap.sample.valid} valid, eff n ${snap.sample.effectiveN}; ${scored}/${snap.titles.length} titles scored`);
