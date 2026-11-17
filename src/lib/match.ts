// "Shows for people like me": re-weights every rating by how similar the rater is to the visitor,
// then shrinks toward the overall score when the matched base is thin. Runs in the browser — no login, no PII.
import { AGE_BANDS, GENRES } from "./questionnaire";
import type { Snapshot, TitleScore } from "./scoring";
import { genreMask } from "./scoring";

export type Profile = {
  ageBand?: (typeof AGE_BANDS)[number];
  gender?: "Man" | "Woman";
  kids?: boolean;
  genres?: string[];
};

export const SHRINK_K = 30; // pseudo-raters at the overall score

function popcount(x: number) { let c = 0; while (x) { x &= x - 1; c++; } return c; }

export function similarity(row: [number, number, number, number, number, number, number], p: Profile): number {
  const [, , , age, gender, kids, gmask] = row;
  let s = 1;
  if (p.ageBand) {
    const d = Math.abs(AGE_BANDS.indexOf(p.ageBand) - age);
    s *= d === 0 ? 1 : d === 1 ? 0.5 : 0.15;
  }
  if (p.gender) s *= (p.gender === "Man" ? 0 : 1) === gender ? 1 : 0.5;
  if (p.kids != null) s *= (p.kids ? 1 : 0) === kids ? 1 : 0.6;
  if (p.genres?.length) {
    const pm = genreMask(p.genres);
    const union = popcount(pm | gmask);
    const jac = union ? popcount(pm & gmask) / union : 0;
    s *= 0.4 + 0.6 * jac;
  }
  return s;
}

export type Match = { id: string; matchScore: number; matchedRaters: number; lift: number };

export function matchScores(snap: Snapshot, p: Profile): Map<string, Match> {
  const acc = snap.titles.map(() => ({ w: 0, x: 0, w2: 0 }));
  for (const row of snap.raters) {
    const w = row[2] * similarity(row, p);
    const a = acc[row[0]];
    if (!a) continue;
    a.w += w; a.x += w * row[1]; a.w2 += w * w;
  }
  const out = new Map<string, Match>();
  snap.titles.forEach((t: TitleScore, i) => {
    if (t.viewerScore == null) return;
    const a = acc[i];
    const effN = a.w2 > 0 ? (a.w * a.w) / a.w2 : 0;
    const raw = a.w > 0 ? a.x / a.w : t.viewerScore;
    const score = (effN * raw + SHRINK_K * t.viewerScore) / (effN + SHRINK_K);
    out.set(t.id, { id: t.id, matchScore: Math.round(score * 10) / 10, matchedRaters: Math.round(effN), lift: Math.round((score - t.viewerScore) * 10) / 10 });
  });
  return out;
}

export function profileIsSet(p: Profile) {
  return !!(p.ageBand || p.gender || p.kids != null || p.genres?.length);
}

export const _genres = GENRES;
