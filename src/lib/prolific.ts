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

type FilterDef = { filter_id?: string; id?: string; title?: string; question?: string; type?: string; choices?: unknown };

/** Find the "country of residence" select filter and the United Kingdom choice in Prolific's filter list. */
export function findUkResidenceFilter(defs: FilterDef[]): { filter_id: string; selected_values: string[] } | null {
  const isCountry = (d: FilterDef) => {
    const text = `${d.filter_id ?? d.id ?? ""} ${d.title ?? ""} ${d.question ?? ""}`.toLowerCase();
    return text.includes("residence") && text.includes("countr");
  };
  for (const d of defs.filter(isCountry)) {
    const id = d.filter_id ?? d.id;
    if (!id || !d.choices) continue;
    // choices may be { "1": "United Kingdom" } or [{ value/id, label/name }]
    const entries: [string, string][] = Array.isArray(d.choices)
      ? (d.choices as Record<string, unknown>[]).map((c) => [String(c.value ?? c.id ?? ""), String(c.label ?? c.name ?? "")])
      : Object.entries(d.choices as Record<string, unknown>).map(([k, v]) => [k, String(v)]);
    const uk = entries.find(([, label]) => label.trim().toLowerCase() === "united kingdom");
    if (uk && uk[0]) return { filter_id: id, selected_values: [uk[0]] };
  }
  return null;
}

/** UK-residents filter: PROLIFIC_FILTERS_JSON if set, otherwise looked up live. Throws rather than field outside the UK. */
export async function ukFilters(): Promise<unknown[]> {
  const manual = parseFilters();
  if (manual.length) return manual;
  const res = await call<{ results?: FilterDef[] } | FilterDef[]>("GET", "/filters/");
  const defs = Array.isArray(res) ? res : res.results ?? [];
  const f = findUkResidenceFilter(defs);
  if (!f) throw new Error("Could not find Prolific's UK country-of-residence filter — not publishing. Set PROLIFIC_FILTERS_JSON manually.");
  return [f];
}

export function parseFilters(): unknown[] {
  const raw = process.env.PROLIFIC_FILTERS_JSON;
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }
  catch { throw new Error("PROLIFIC_FILTERS_JSON is not valid JSON"); }
}
