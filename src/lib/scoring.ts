// Turns cleaned, weighted survey responses into the daily dataset the dashboard reads.
import {
  ATTRIBUTE_KEYS, AttributeKey, OCCASION_KEYS, OccasionKey, ViewStatus, WATCHED, ageBand, AGE_BANDS, GENRES,
} from "./questionnaire";
import { rake, gradeGroup, Targets, UK_ADULT_TARGETS, NETFLIX_SUBSCRIBER_TARGETS } from "./weighting";

export const MIN_SCORED = 100; // raters needed for a full score
export const MIN_EARLY = 50;   // raters needed to show an "Early" score

export type RatingRecord = {
  titleId: string;
  rating: number;      // 1–10
  recommend: number;   // 0–10
  attributes: Partial<Record<AttributeKey, number>>; // 1–5
  occasions: OccasionKey[];
  kidSafe: "yes" | "older" | "no" | null;
};

export type RespondentRecord = {
  id: string;
  completedAt: string;   // ISO
  durationSec: number;
  age: number;
  region: string | null;
  gender: string | null;
  grade: string | null;  // AB | C1 | C2 | DE
  household: string[];
  genres: string[];
  attentionOk: boolean;
  decoyClaimed: boolean;
  straightliner: boolean;
  viewing: Record<string, { status: ViewStatus; plan?: boolean; heardVia?: string | null }>;
  ratings: RatingRecord[];
};

export type TitleMeta = { id: string; name: string; kind: "tv" | "film"; chartRank: number | null };

export type TitleScore = TitleMeta & {
  status: "scored" | "early" | "too_new";
  raters: number;
  effectiveRaters: number;
  viewerScore: number | null;     // 0–100
  ci95: number | null;            // ± points
  avgRating: number | null;       // 1–10
  netRecommend: number | null;    // -100..100
  reach: number;                  // share of Netflix users shown the title who watched any of it
  awareness: number;
  completion: number | null;      // finished / (finished + stopped)
  planToWatch: number;
  wordOfMouth: number | null;     // share who heard via friends/family or social
  reachChange: number | null;     // points vs prior 7 days
  momentum: number;               // trending score
  scoreChange: number | null;     // vs previous published snapshot
  attributes: Partial<Record<AttributeKey, number>>;
  attributeIndex: Partial<Record<AttributeKey, number>>; // 100 = average title
  occasions: Partial<Record<OccasionKey, number>>;       // share picking each
  kidSafe: number | null;         // share saying "Yes"
  tags: AttributeKey[];           // top distinctive attributes
  lovedBy: { segment: string; score: number } | null;
  leastLovedBy: { segment: string; score: number } | null;
};

// Compact per-rating rows so "people like me" can be computed in the browser without any personal data.
// [titleIndex, compositeScore 0-100, weight, ageBandIdx, genderIdx(0 man,1 woman,2 other/na), hasKids(0|1), genreBitmask]
export type RaterRow = [number, number, number, number, number, number, number];

export type Snapshot = {
  version: 1;
  platform: "netflix";
  snapshotDate: string;
  generatedAt: string;
  chartWeek: string | null;
  window: { from: string; to: string };
  sample: { completes: number; valid: number; excluded: number; effectiveN: number; efficiency: number };
  titles: TitleScore[];
  raters: RaterRow[];
  demo?: boolean;
};

/** Per-rating composite: mean of these equals Viewer Score exactly. */
export function composite(rating: number, recommend: number): number {
  const ratingPart = ((rating - 1) / 9) * 100;
  const recPart = recommend >= 9 ? 100 : recommend <= 6 ? 0 : 50;
  return 0.5 * ratingPart + 0.5 * recPart;
}

export function qualityExclusions(rs: RespondentRecord[]): Set<string> {
  const durations = rs.map((r) => r.durationSec).filter((d) => d > 0).sort((a, b) => a - b);
  const median = durations.length ? durations[Math.floor(durations.length / 2)] : 0;
  const tooFast = median * 0.4;
  const out = new Set<string>();
  for (const r of rs) {
    if (r.decoyClaimed || !r.attentionOk || r.straightliner || (median > 0 && r.durationSec < tooFast)) out.add(r.id);
  }
  return out;
}

export function weightRespondents(rs: RespondentRecord[], targets: Targets = UK_ADULT_TARGETS) {
  const rows = rs.map((r) => ({
    id: r.id,
    cells: { ageBand: ageBand(r.age), gender: r.gender, region: r.region, grade: gradeGroup(r.grade) },
  }));
  // Every respondent is a Netflix user, so the ideal targets are the UK Netflix-subscriber profile.
  // Until those figures are loaded, weight to the UK adult profile; subscriber targets override per dimension.
  return rake(rows, NETFLIX_SUBSCRIBER_TARGETS ? { ...targets, ...NETFLIX_SUBSCRIBER_TARGETS } : targets);
}

type Acc = { w: number; x: number; x2: number; w2: number; n: number };
const acc = (): Acc => ({ w: 0, x: 0, x2: 0, w2: 0, n: 0 });
const add = (a: Acc, x: number, w: number) => { a.w += w; a.x += w * x; a.x2 += w * x * x; a.w2 += w * w; a.n += 1; };
const mean = (a: Acc) => (a.w > 0 ? a.x / a.w : null);

function windowStats(rs: RespondentRecord[], weights: Map<string, number>, titleId: string) {
  let shown = 0, watched = 0, aware = 0, plan = 0, finished = 0, stopped = 0, heardAns = 0, wom = 0;
  for (const r of rs) {
    const v = r.viewing[titleId];
    if (!v) continue;
    const w = weights.get(r.id) ?? 1;
    shown += w;
    if (WATCHED.includes(v.status)) watched += w;
    if (v.status !== "never") aware += w;
    if (v.plan) plan += w;
    if (v.status === "finished") finished += w;
    if (v.status === "stopped") stopped += w;
    if (v.heardVia) {
      heardAns += w;
      if (v.heardVia === "Friend or family" || v.heardVia === "Social media") wom += w;
    }
  }
  return {
    shown,
    reach: shown ? watched / shown : 0,
    awareness: shown ? aware / shown : 0,
    plan: shown ? plan / shown : 0,
    completion: finished + stopped > 0 ? finished / (finished + stopped) : null,
    wom: heardAns > 0 ? wom / heardAns : null,
  };
}

export function genderIdx(g: string | null): number { return g === "Man" ? 0 : g === "Woman" ? 1 : 2; }
export function genreMask(genres: string[]): number {
  return genres.reduce((m, g) => { const i = GENRES.indexOf(g as (typeof GENRES)[number]); return i >= 0 ? m | (1 << i) : m; }, 0);
}

/**
 * Build the daily snapshot.
 * @param current respondents completed in the 7-day window
 * @param previous respondents in the 7 days before that (for momentum); may be empty
 */
export function buildSnapshot(args: {
  snapshotDate: string;
  chartWeek: string | null;
  window: { from: string; to: string };
  titles: TitleMeta[];
  current: RespondentRecord[];
  previous: RespondentRecord[];
  previousScores?: Map<string, number | null>;
}): Snapshot {
  const { titles, current, previous } = args;
  const excluded = qualityExclusions(current);
  const valid = current.filter((r) => !excluded.has(r.id));
  const wr = weightRespondents(valid);
  const prevExcluded = qualityExclusions(previous);
  const prevValid = previous.filter((r) => !prevExcluded.has(r.id));
  const prevW = weightRespondents(prevValid).weights;

  const titleIndex = new Map(titles.map((t, i) => [t.id, i]));

  // Pass 1: per-title rating accumulators
  const perTitle = new Map<string, {
    comp: Acc; rating: Acc; promoters: number; detractors: number; recW: number;
    attr: Record<string, Acc>; occ: Record<string, number>; kidYes: number; kidAns: number;
    seg: Record<string, Acc>;
  }>();
  const raters: RaterRow[] = [];
  for (const t of titles) {
    perTitle.set(t.id, {
      comp: acc(), rating: acc(), promoters: 0, detractors: 0, recW: 0,
      attr: Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, acc()])), occ: {}, kidYes: 0, kidAns: 0, seg: {},
    });
  }
  for (const r of valid) {
    const w = wr.weights.get(r.id) ?? 1;
    const band = ageBand(r.age);
    for (const rt of r.ratings) {
      const p = perTitle.get(rt.titleId);
      if (!p) continue;
      const c = composite(rt.rating, rt.recommend);
      add(p.comp, c, w);
      add(p.rating, rt.rating, w);
      p.recW += w;
      if (rt.recommend >= 9) p.promoters += w;
      if (rt.recommend <= 6) p.detractors += w;
      for (const k of ATTRIBUTE_KEYS) { const v = rt.attributes[k]; if (typeof v === "number") add(p.attr[k], v, w); }
      for (const o of rt.occasions) p.occ[o] = (p.occ[o] ?? 0) + w;
      if (rt.kidSafe) { p.kidAns += w; if (rt.kidSafe === "yes") p.kidYes += w; }
      for (const seg of [`Age ${band}`, r.gender === "Man" ? "Men" : r.gender === "Woman" ? "Women" : null]) {
        if (!seg) continue;
        p.seg[seg] ??= acc();
        add(p.seg[seg], c, w);
      }
      raters.push([
        titleIndex.get(rt.titleId)!, Math.round(c * 10) / 10, Math.round(w * 1000) / 1000,
        AGE_BANDS.indexOf(band), genderIdx(r.gender), r.household.includes("Children under 16") ? 1 : 0, genreMask(r.genres),
      ]);
    }
  }

  // Average attribute level across titles (for indexing)
  const attrAvg: Record<string, number> = {};
  for (const k of ATTRIBUTE_KEYS) {
    const vals = [...perTitle.values()].map((p) => mean(p.attr[k])).filter((v): v is number => v != null);
    attrAvg[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 3;
  }

  const scores: TitleScore[] = titles.map((t) => {
    const p = perTitle.get(t.id)!;
    const n = p.comp.n;
    const effN = p.comp.w2 > 0 ? (p.comp.w * p.comp.w) / p.comp.w2 : 0;
    const vs = mean(p.comp);
    let ci: number | null = null;
    if (vs != null && p.comp.w > 0 && effN > 1) {
      const variance = Math.max(0, p.comp.x2 / p.comp.w - vs * vs);
      ci = 1.96 * Math.sqrt(variance / effN);
    }
    const now = windowStats(valid, wr.weights, t.id);
    const prev = windowStats(prevValid, prevW, t.id);
    const prevReach = prev.shown > 0 ? prev.reach : 0; // not shown last week = new arrival
    const reachChange = now.shown > 0 ? (now.reach - prevReach) * 100 : null;
    const momentum = (reachChange ?? 0) + 50 * now.plan + 25 * (now.wom ?? 0);

    const attributes: TitleScore["attributes"] = {};
    const attributeIndex: TitleScore["attributeIndex"] = {};
    for (const k of ATTRIBUTE_KEYS) {
      const m = mean(p.attr[k]);
      if (m != null) { attributes[k] = round(m, 2); attributeIndex[k] = Math.round((m / attrAvg[k]) * 100); }
    }
    const occasions: TitleScore["occasions"] = {};
    for (const o of OCCASION_KEYS) if (p.comp.w > 0) occasions[o] = round((p.occ[o] ?? 0) / p.comp.w, 3);
    const tags = (Object.entries(attributeIndex) as [AttributeKey, number][])
      .filter(([k, idx]) => idx >= 105 && (attributes[k] ?? 0) >= 3.4)
      .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);

    const segs = Object.entries(p.seg).filter(([, a]) => a.n >= 25).map(([segment, a]) => ({ segment, score: Math.round(mean(a)!) }));
    segs.sort((a, b) => b.score - a.score);
    const spread = segs.length >= 2 && segs[0].score - segs[segs.length - 1].score >= 5;

    const status: TitleScore["status"] = n >= MIN_SCORED ? "scored" : n >= MIN_EARLY ? "early" : "too_new";
    const show = status !== "too_new";
    const prevScore = args.previousScores?.get(t.id);
    const viewerScore = show && vs != null ? round(vs, 1) : null;
    return {
      ...t,
      status,
      raters: n,
      effectiveRaters: Math.round(effN),
      viewerScore,
      ci95: show && ci != null ? round(ci, 1) : null,
      avgRating: show ? round(mean(p.rating) ?? 0, 2) : null,
      netRecommend: show && p.recW > 0 ? Math.round(((p.promoters - p.detractors) / p.recW) * 100) : null,
      reach: round(now.reach, 3),
      awareness: round(now.awareness, 3),
      completion: now.completion != null ? round(now.completion, 3) : null,
      planToWatch: round(now.plan, 3),
      wordOfMouth: now.wom != null ? round(now.wom, 3) : null,
      reachChange: reachChange != null ? round(reachChange, 1) : null,
      momentum: round(momentum, 1),
      scoreChange: viewerScore != null && prevScore != null ? round(viewerScore - prevScore, 1) : null,
      attributes: show ? attributes : {},
      attributeIndex: show ? attributeIndex : {},
      occasions: show ? occasions : {},
      kidSafe: show && p.kidAns > 0 ? round(p.kidYes / p.kidAns, 3) : null,
      tags: show ? tags : [],
      lovedBy: show && spread ? segs[0] : null,
      leastLovedBy: show && spread ? segs[segs.length - 1] : null,
    };
  });

  return {
    version: 1,
    platform: "netflix",
    snapshotDate: args.snapshotDate,
    generatedAt: new Date().toISOString(),
    chartWeek: args.chartWeek,
    window: args.window,
    sample: {
      completes: current.length,
      valid: valid.length,
      excluded: excluded.size,
      effectiveN: Math.round(wr.effectiveN),
      efficiency: round(wr.efficiency, 3),
    },
    titles: scores,
    raters,
  };
}

function round(x: number, dp: number) { const f = 10 ** dp; return Math.round(x * f) / f; }
