// Natural-language search. A query becomes structured filters (by Claude if a key is set, otherwise by rules),
// then titles are ranked from the dataset. The model never names titles, so search can't invent shows.
import { z } from "zod";
import { ATTRIBUTE_KEYS, AttributeKey, OCCASION_KEYS, OccasionKey, ATTRIBUTES, OCCASIONS, AGE_BANDS } from "./questionnaire";
import type { Snapshot, TitleScore } from "./scoring";
import type { Match, Profile } from "./match";

export const FiltersSchema = z.object({
  kind: z.enum(["tv", "film"]).nullable().default(null),
  attributes: z.array(z.enum(ATTRIBUTE_KEYS as [AttributeKey, ...AttributeKey[]])).default([]),
  avoid: z.array(z.enum(ATTRIBUTE_KEYS as [AttributeKey, ...AttributeKey[]])).default([]),
  occasions: z.array(z.enum(OCCASION_KEYS as [OccasionKey, ...OccasionKey[]])).default([]),
  familySafe: z.boolean().default(false),
  sort: z.enum(["score", "trending"]).default("score"),
  profile: z.object({
    ageBand: z.enum(AGE_BANDS).optional(),
    gender: z.enum(["Man", "Woman"]).optional(),
    kids: z.boolean().optional(),
  }).default({}),
  summary: z.string().default(""),
});
export type Filters = z.infer<typeof FiltersSchema>;

const RULES: { re: RegExp; apply: (f: Filters) => void }[] = [
  { re: /\b(series|show|shows|tv|box ?set|episodes?)\b/, apply: (f) => { f.kind = "tv"; } },
  { re: /\b(film|films|movie|movies)\b/, apply: (f) => { f.kind = "film"; } },
  { re: /\b(funny|comedy|comedies|laugh|hilarious|lighthearted|light-hearted)\b/, apply: (f) => { add(f.attributes, "funny"); add(f.occasions, "laugh"); } },
  { re: /\b(gripping|thriller|thrilling|edge of (my|your) seat|suspense|page.?turner)\b/, apply: (f) => { add(f.attributes, "gripping"); add(f.occasions, "edge"); } },
  { re: /\b(scary|horror|creepy|tense|frightening)\b/, apply: (f) => add(f.attributes, "tense") },
  { re: /\b(moving|emotional|cry|tear.?jerker|heartwarming|heart-warming|touching)\b/, apply: (f) => add(f.attributes, "moving") },
  { re: /\b(thought.?provoking|clever|smart|intelligent|makes? you think)\b/, apply: (f) => add(f.attributes, "thoughtful") },
  { re: /\b(easy|light|chill|relax|relaxing|unwind|switch off|cosy|cozy)\b/, apply: (f) => { add(f.attributes, "easy"); add(f.occasions, "unwind"); } },
  { re: /\b(binge|bingeable|addictive|can'?t stop)\b/, apply: (f) => { add(f.attributes, "bingeable"); add(f.occasions, "binge"); } },
  { re: /\b(beautiful|stunning|gorgeous|visual|cinematic)\b/, apply: (f) => add(f.attributes, "stunning") },
  { re: /\b(acting|performances?|cast)\b/, apply: (f) => add(f.attributes, "acting") },
  { re: /\b(ending|satisfying)\b/, apply: (f) => add(f.attributes, "ending") },
  { re: /\b(kids?|children|child|family|young ones|little ones)\b/, apply: (f) => { f.familySafe = true; add(f.occasions, "family"); } },
  { re: /\b(teen|teens|teenager|teenagers)\b/, apply: (f) => add(f.occasions, "family") },
  { re: /\b(date night|date|partner|wife|husband|girlfriend|boyfriend|couple)\b/, apply: (f) => add(f.occasions, "date") },
  { re: /\b(background|while i (work|cook))\b/, apply: (f) => add(f.occasions, "background") },
  { re: /\b(trending|everyone'?s watching|popular|talked about|buzz)\b/, apply: (f) => { f.sort = "trending"; } },
  { re: /\b(not|no|nothing|without) (too )?(scary|violent|gory|dark|graphic)\b/, apply: (f) => { f.avoid.push("tense"); f.attributes = f.attributes.filter((a) => a !== "tense"); } },
];
function add<T>(xs: T[], x: T) { if (!xs.includes(x)) xs.push(x); }

export function parseQueryRules(q: string): Filters {
  const text = q.toLowerCase();
  const f = FiltersSchema.parse({});
  for (const r of RULES) if (r.re.test(text)) r.apply(f);
  const age = text.match(/\bi'?m (\d{2})\b|\baged? (\d{2})\b/);
  if (age) {
    const n = Number(age[1] ?? age[2]);
    f.profile.ageBand = n < 25 ? "18-24" : n < 35 ? "25-34" : n < 45 ? "35-44" : n < 55 ? "45-54" : n < 65 ? "55-64" : "65+";
  }
  if (/\bi'?m a (woman|mum|mom)\b/.test(text)) f.profile.gender = "Woman";
  if (/\bi'?m a (man|guy|dad)\b/.test(text)) f.profile.gender = "Man";
  if (/\b(my kids|my children|with (the |my )?kids)\b/.test(text)) f.profile.kids = true;
  f.summary = describe(f);
  return f;
}

export function describe(f: Filters): string {
  const parts: string[] = [];
  if (f.kind) parts.push(f.kind === "tv" ? "series" : "films");
  if (f.attributes.length) parts.push(f.attributes.map((a) => ATTRIBUTES[a].toLowerCase()).join(", "));
  if (f.occasions.length) parts.push(`good for ${f.occasions.map((o) => OCCASIONS[o].toLowerCase()).join(" / ")}`);
  if (f.familySafe) parts.push("suitable for under-12s");
  if (f.avoid.length) parts.push(`not ${f.avoid.map((a) => ATTRIBUTES[a].toLowerCase()).join(", ")}`);
  if (f.sort === "trending") parts.push("trending now");
  return parts.length ? parts.join(" · ") : "best rated overall";
}

export const LLM_SYSTEM = `You turn a viewer's request for something to watch into JSON filters for a ranking engine.
Only output a single JSON object, no prose. Never name or suggest any title.
Schema:
{"kind": "tv"|"film"|null,
 "attributes": subset of ${JSON.stringify(ATTRIBUTE_KEYS)},
 "avoid": subset of the same attribute keys (things they explicitly don't want),
 "occasions": subset of ${JSON.stringify(OCCASION_KEYS)},
 "familySafe": boolean (true only if children under 12 will watch),
 "sort": "score"|"trending",
 "profile": {"ageBand"?: one of ${JSON.stringify(AGE_BANDS)}, "gender"?: "Man"|"Woman", "kids"?: boolean} (only what they state about themselves),
 "summary": a short plain-English restatement of what they want, under 12 words}`;

export async function parseQueryLLM(q: string): Promise<Filters | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL ?? "claude-haiku-5-5",
        max_tokens: 300,
        system: LLM_SYSTEM,
        messages: [{ role: "user", content: q.slice(0, 400) }],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const text: string = j.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = FiltersSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type Ranked = { title: TitleScore; score: number; base: number; why: string[] };

export function rank(snap: Snapshot, f: Filters, matches?: Map<string, Match>): Ranked[] {
  const out: Ranked[] = [];
  for (const t of snap.titles) {
    if (t.viewerScore == null) continue;
    if (f.kind && t.kind !== f.kind) continue;
    if (f.familySafe && (t.kidSafe ?? 0) < 0.5) continue;
    if (f.avoid.some((a) => (t.attributeIndex[a] ?? 100) > 110)) continue;
    const base = f.sort === "trending" ? 50 + t.momentum : matches?.get(t.id)?.matchScore ?? t.viewerScore;
    let fit = 0;
    const why: string[] = [];
    for (const a of f.attributes) {
      const idx = t.attributeIndex[a] ?? 100;
      fit += (idx - 100) * 0.4;
      if (idx >= 108) why.push(`${ATTRIBUTES[a]} (index ${idx})`);
    }
    for (const o of f.occasions) {
      const share = t.occasions[o] ?? 0;
      fit += share * 25;
      if (share >= 0.3) why.push(`${Math.round(share * 100)}% say "${OCCASIONS[o].toLowerCase()}"`);
    }
    if (f.familySafe && t.kidSafe != null) why.push(`${Math.round(t.kidSafe * 100)}% say fine for under-12s`);
    out.push({ title: t, base, score: base + fit, why });
  }
  return out.sort((a, b) => b.score - a.score);
}
