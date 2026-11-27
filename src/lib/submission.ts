// Validation + quality flags for a survey submission. Shared by the API route and tests.
import { z } from "zod";
import {
  ATTRIBUTE_KEYS, OCCASION_KEYS, REGIONS, SERVICES, HOURS, GENDERS, HOUSEHOLD, GENRES, ATTENTION_CHECK,
  STOP_REASONS, HEARD_VIA, WATCHED_WITH, LOYALTY, MAX_DEEP_DIVES, VIEW_STATUS, UK_KEYS, PAST_VOTE, UK_CHECK, UK_MIN_SECONDS,
} from "./questionnaire";

const viewStatus = z.enum(Object.keys(VIEW_STATUS) as [string, ...string[]]);
const attrScore = z.number().int().min(1).max(5);

const ukScore = z.number().int().min(1).max(5);
export const UkSchema = z.object({
  statements: z.object(Object.fromEntries(UK_KEYS.map((k) => [k, ukScore])) as Record<string, typeof ukScore>),
  check: ukScore,
  pastVote: z.enum(PAST_VOTE),
  seconds: z.number().int().min(0).max(36000),
});
export type UkAnswers = z.infer<typeof UkSchema>;
export const ukValid = (u: { check: number | null; seconds: number | null }) => u.check === UK_CHECK.answer && (u.seconds ?? 0) >= UK_MIN_SECONDS;

// Screened-out people answer the demographics and UK Pulse before the Netflix screener
export const ScreenedSchema = z.object({
  screenedOut: z.literal(true),
  waveId: z.number().int(),
  prolificPid: z.string().max(64).optional().nullable(),
  sessionId: z.string().max(64).optional().nullable(),
  startedAt: z.string(),
  about: z.object({
    age: z.number().int().min(16).max(110),
    region: z.enum(REGIONS),
    gender: z.enum(GENDERS),
    grade: z.enum(["AB", "C1", "C2", "DE"]),
  }),
  uk: UkSchema,
});

export const SubmissionSchema = z.object({
  waveId: z.number().int(),
  prolificPid: z.string().max(64).optional().nullable(),
  sessionId: z.string().max(64).optional().nullable(),
  startedAt: z.string(),
  screener: z.object({
    age: z.number().int().min(18).max(110),
    region: z.enum(REGIONS),
    services: z.array(z.enum(SERVICES)).min(1),
    hours: z.enum(HOURS),
  }),
  viewing: z.record(z.string(), viewStatus),               // includes the decoy title id "__decoy"
  stopReasons: z.record(z.string(), z.enum(STOP_REASONS)).default({}),
  plans: z.array(z.string()).default([]),
  heardVia: z.record(z.string(), z.enum(HEARD_VIA)).default({}),
  ratings: z.array(z.object({
    titleId: z.string(),
    rating: z.number().int().min(1).max(10),
    recommend: z.number().int().min(0).max(10),
    watchedWith: z.array(z.enum(WATCHED_WITH)).default([]),
    loyalty: z.enum(LOYALTY).nullable().default(null),
    attributes: z.object(Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, attrScore])) as Record<string, typeof attrScore>),
    occasions: z.array(z.enum(OCCASION_KEYS as [string, ...string[]])).max(3).default([]),
    kidSafe: z.enum(["yes", "older", "no"]).nullable().default(null),
  })).max(MAX_DEEP_DIVES),
  profile: z.object({
    gender: z.enum(GENDERS),
    household: z.array(z.enum(HOUSEHOLD)).min(1),
    grade: z.enum(["AB", "C1", "C2", "DE"]),
    genres: z.array(z.enum(GENRES)).min(1).max(5),
    attitudes: z.record(z.string(), z.number().int().min(1).max(5)),
    bestTitle: z.string().max(120).optional().nullable(),
    attention: z.string(),
  }),
  uk: UkSchema.optional(),
});
export type Submission = z.infer<typeof SubmissionSchema>;

export const DECOY_ID = "__decoy";

export function qualityFlags(s: Submission) {
  const decoy = s.viewing[DECOY_ID];
  const decoyClaimed = decoy === "finished" || decoy === "watching" || decoy === "stopped";
  const attentionOk = s.profile.attention === ATTENTION_CHECK.answer;
  const flat = s.ratings.map((r) => new Set(Object.values(r.attributes)).size === 1);
  const straightliner = flat.length > 0 && flat.every(Boolean);
  return { decoyClaimed, attentionOk, straightliner };
}

export function isEligible(screener: { age: number; services: string[] }) {
  return screener.age >= 18 && screener.services.includes("Netflix");
}
