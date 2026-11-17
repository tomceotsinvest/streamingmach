// Rim weighting (raking / iterative proportional fitting) to UK adult population targets.
import { AGE_BANDS, REGIONS } from "./questionnaire";

export type Targets = Record<string, Record<string, number>>; // dimension -> category -> share (sums to 1)

// UK adults 18+. APPROXIMATE shares based on ONS mid-year population estimates and Census 2021.
// Replace with exact current ONS figures before launch (see README → "Weighting targets").
export const UK_ADULT_TARGETS: Targets = {
  ageBand: { "18-24": 0.105, "25-34": 0.170, "35-44": 0.163, "45-54": 0.162, "55-64": 0.156, "65+": 0.244 },
  gender: { Man: 0.49, Woman: 0.51 },
  region: {
    "North East": 0.039, "North West": 0.110, "Yorkshire and the Humber": 0.082, "East Midlands": 0.073,
    "West Midlands": 0.089, "East of England": 0.096, London: 0.134, "South East": 0.140, "South West": 0.086,
    Wales: 0.046, Scotland: 0.081, "Northern Ireland": 0.028,
  },
  grade: { ABC1: 0.57, C2DE: 0.43 },
};

// Optional second layer: the profile of Netflix subscribers (e.g. from BARB Establishment Survey).
// Leave null until you license / obtain the figures; weighting then stops at the UK-adult layer.
export const NETFLIX_SUBSCRIBER_TARGETS: Targets | null = null;

export type WeightInput = { id: string; cells: Record<string, string | null> };

export type WeightResult = {
  weights: Map<string, number>;
  iterations: number;
  converged: boolean;
  efficiency: number; // effective n / n
  effectiveN: number;
};

/**
 * Rake to marginal targets. Respondents with a missing/unmapped category on a dimension keep their
 * weight for that dimension (e.g. gender "Prefer not to say"). Weights are capped at `cap` × mean and renormalised.
 */
export function rake(rows: WeightInput[], targets: Targets, opts: { cap?: number; maxIter?: number; tol?: number } = {}): WeightResult {
  const cap = opts.cap ?? 5;
  const maxIter = opts.maxIter ?? 100;
  const tol = opts.tol ?? 1e-4;
  const n = rows.length;
  const w = new Map(rows.map((r) => [r.id, 1]));
  if (n === 0) return { weights: w, iterations: 0, converged: true, efficiency: 1, effectiveN: 0 };

  const dims = Object.keys(targets);
  let iterations = 0;
  let converged = false;

  for (; iterations < maxIter; iterations++) {
    let maxDelta = 0;
    for (const dim of dims) {
      const t = targets[dim];
      // Only rake among respondents with a category this dimension knows about
      const inScope = rows.filter((r) => r.cells[dim] != null && t[r.cells[dim] as string] != null);
      const scopeTotal = inScope.reduce((s, r) => s + w.get(r.id)!, 0);
      if (scopeTotal === 0) continue;
      const sums: Record<string, number> = {};
      for (const r of inScope) sums[r.cells[dim]!] = (sums[r.cells[dim]!] ?? 0) + w.get(r.id)!;
      // Renormalise targets to the categories actually present (an empty cell can't be weighted up)
      const present = Object.keys(sums);
      const tPresent = present.reduce((s, k) => s + t[k], 0);
      for (const r of inScope) {
        const k = r.cells[dim]!;
        const want = (t[k] / tPresent) * scopeTotal;
        const factor = want / sums[k];
        maxDelta = Math.max(maxDelta, Math.abs(factor - 1));
        w.set(r.id, w.get(r.id)! * factor);
      }
    }
    capAndNormalise(w, n, cap);
    if (maxDelta < tol) { converged = true; break; }
  }
  capAndNormalise(w, n, cap);
  const sw = [...w.values()].reduce((a, b) => a + b, 0);
  const sw2 = [...w.values()].reduce((a, b) => a + b * b, 0);
  const effectiveN = (sw * sw) / sw2;
  return { weights: w, iterations, converged, efficiency: effectiveN / n, effectiveN };
}

/** Trim weights to `cap` × mean and renormalise to mean 1, repeating until the cap holds after renormalising. */
function capAndNormalise(w: Map<string, number>, n: number, cap: number) {
  for (let i = 0; i < 50; i++) {
    const mean = [...w.values()].reduce((a, b) => a + b, 0) / n;
    for (const [k, v] of w) w.set(k, v / mean);
    let over = false;
    for (const [k, v] of w) if (v > cap * (1 + 1e-9)) { w.set(k, cap); over = true; }
    if (!over) return;
  }
}

export function gradeGroup(g: string | null | undefined): string | null {
  if (g === "AB" || g === "C1") return "ABC1";
  if (g === "C2" || g === "DE") return "C2DE";
  return null;
}

export const _knownCategories = { AGE_BANDS, REGIONS };
