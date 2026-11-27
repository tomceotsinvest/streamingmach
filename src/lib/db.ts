import postgres from "postgres";

let client: ReturnType<typeof postgres> | null = null;

// DATABASE_URL if set by hand; otherwise POSTGRES_URL, which the Supabase ↔ Vercel integration sets automatically
export function dbUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined;
}

export function hasDb(): boolean {
  return !!dbUrl();
}

export function sql() {
  const url = dbUrl();
  if (!url) throw new Error("DATABASE_URL is not set");
  // prepare:false keeps it compatible with Supabase's transaction pooler (port 6543)
  client ??= postgres(url, { prepare: false, max: 5, idle_timeout: 20 });
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

// Additive, idempotent schema changes, so new fields don't need a manual SQL step.
let schemaReady: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    const db = sql();
    await db`alter table respondents add column if not exists gender text`;
    await db`alter table respondents add column if not exists uk jsonb`;
    await db`alter table respondents add column if not exists uk_check smallint`;
    await db`alter table respondents add column if not exists uk_seconds int`;
    await db`alter table respondents add column if not exists past_vote text`;
  })().catch((e) => { schemaReady = null; throw e; });
  return schemaReady;
}
