// Prolific API client — creates and publishes one study per daily wave.
// Docs: https://docs.prolific.com/api-reference  ·  Auth: "Authorization: Token <PROLIFIC_API_TOKEN>"

const API = "https://api.prolific.com/api/v1";

export type StudyConfig = {
  name: string;
  internalName: string;
  description: string;
  externalUrl: string;           // our survey URL, with Prolific placeholders appended
  places: number;
  minutes: number;
  rewardPence: number;
  completionCode: string;
  filters?: unknown[];           // Prolific eligibility filters (e.g. UK residents) — see README
  projectId?: string;
};

function token(): string {
  const t = process.env.PROLIFIC_API_TOKEN;
  if (!t) throw new Error("PROLIFIC_API_TOKEN is not set");
  return t;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Token ${token()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Prolific ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Build the study payload. Exported so it can be unit-tested without network. */
export function studyPayload(c: StudyConfig) {
  const sep = c.externalUrl.includes("?") ? "&" : "?";
  return {
    name: c.name,
    internal_name: c.internalName,
    description: c.description,
    external_study_url:
      `${c.externalUrl}${sep}PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`,
    prolific_id_option: "url_parameters",
    completion_codes: [
      { code: c.completionCode, code_type: "COMPLETED", actions: [{ action: "AUTOMATICALLY_APPROVE" }] },
    ],
    total_available_places: c.places,
    estimated_completion_time: c.minutes,
    maximum_allowed_time: c.minutes * 5,
    reward: c.rewardPence,
    device_compatibility: ["desktop", "tablet", "mobile"],
    ...(c.filters && c.filters.length ? { filters: c.filters } : {}),
    ...(c.projectId ? { project: c.projectId } : {}),
  };
}

export async function createAndPublishStudy(c: StudyConfig): Promise<{ id: string }> {
  const study = await call<{ id: string }>("POST", "/studies/", studyPayload(c));
  await call("POST", `/studies/${study.id}/transition/`, { action: "PUBLISH" });
  return { id: study.id };
}

export async function stopStudy(id: string): Promise<void> {
  await call("POST", `/studies/${id}/transition/`, { action: "STOP" });
}

export function rewardPence(minutes: number, hourlyGbp: number): number {
  return Math.ceil((minutes / 60) * hourlyGbp * 100);
}

export function completionUrl(code: string): string {
  return `https://app.prolific.com/submissions/complete?cc=${encodeURIComponent(code)}`;
}

export function parseFilters(): unknown[] {
  const raw = process.env.PROLIFIC_FILTERS_JSON;
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }
  catch { throw new Error("PROLIFIC_FILTERS_JSON is not valid JSON"); }
}
