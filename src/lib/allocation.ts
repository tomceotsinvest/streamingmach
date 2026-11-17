// Picks which watched titles each respondent rates in depth: the ones furthest from their sample target.
import { MAX_DEEP_DIVES, ViewStatus, WATCHED } from "./questionnaire";
import { MIN_SCORED } from "./scoring";

export function allocateDeepDives(
  viewing: Record<string, ViewStatus>,
  raterCounts: Record<string, number>,
  opts: { max?: number; target?: number; random?: () => number } = {},
): string[] {
  const max = opts.max ?? MAX_DEEP_DIVES;
  const target = opts.target ?? MIN_SCORED;
  const rnd = opts.random ?? Math.random;
  const eligible = Object.entries(viewing).filter(([, s]) => WATCHED.includes(s)).map(([id]) => id);
  return eligible
    .map((id) => ({ id, gap: target - (raterCounts[id] ?? 0), tie: rnd() }))
    // Biggest gap first; once everyone is at target, keep sampling evenly at random
    .sort((a, b) => (Math.max(b.gap, 0) - Math.max(a.gap, 0)) || (a.tie - b.tie))
    .slice(0, max)
    .map((x) => x.id);
}
