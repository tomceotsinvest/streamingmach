import postgres from "postgres";

let client: ReturnType<typeof postgres> | null = null;

export function hasDb(): boolean {
  return !!process.env.DATABASE_URL;
}

export function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  // prepare:false keeps it compatible with Supabase's transaction pooler (port 6543)
  client ??= postgres(process.env.DATABASE_URL, { prepare: false, max: 5, idle_timeout: 20 });
  return client;
}

export const config = {
  appUrl: () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  dailyCompletes: () => Number(process.env.DAILY_COMPLETES ?? 175),
  surveyMinutes: () => Number(process.env.SURVEY_MINUTES ?? 8),
  hourlyGbp: () => Number(process.env.PROLIFIC_HOURLY_GBP ?? 9),
  autoPublish: () => process.env.PROLIFIC_AUTO_PUBLISH === "true",
  minWeeklyValid: () => Number(process.env.GUARD_MIN_WEEKLY_VALID ?? 300),
  maxExclusionRate: () => Number(process.env.GUARD_MAX_EXCLUSION_RATE ?? 0.25),
  maxScoreSwing: () => Number(process.env.GUARD_MAX_SCORE_SWING ?? 15),
};
