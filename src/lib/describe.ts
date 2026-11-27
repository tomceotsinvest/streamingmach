// Short show descriptions. TMDB (plot overview) when TMDB_API_KEY is set, otherwise Wikipedia's page summary.
// Bump to re-fetch every stored description after changing the rules. Adding a TMDB key also triggers one re-fetch.
export const DESCRIPTION_VERSION = 2;
export const descriptionVersion = () => DESCRIPTION_VERSION * 10 + (process.env.TMDB_API_KEY ? 1 : 0);
export type Description = { text: string; source: "tmdb" | "wikipedia"; url: string };

const UA = "streaming-machine/1.0 (https://streamingmach.vercel.app)";
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/** Trim to whole sentences, at most `max` characters. */
export function shorten(text: string, max = 240): string {
  const clean = text.replace(/\s+/g, " ").replace(/\s*\([^)]*(pronounced|listen|born)[^)]*\)/gi, "").trim();
  if (clean.length <= max) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [clean];
  let out = "";
  for (const s of sentences) { if ((out + s).trim().length > max) break; out += s; }
  return out.trim() || clean.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(6000), cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${url.split("?")[0]}`);
  return res.json();
}

async function fromTmdb(show: string, kind: "tv" | "film"): Promise<Description | null> {
  const key = process.env.TMDB_API_KEY;
  if (!key) return null;
  const bearer = key.length > 40; // v4 read token vs v3 key
  const path = kind === "tv" ? "tv" : "movie";
  const q = `https://api.themoviedb.org/3/search/${path}?query=${encodeURIComponent(show)}&language=en-GB${bearer ? "" : `&api_key=${key}`}`;
  const j = await getJson(q, bearer ? { Authorization: `Bearer ${key}` } : {});
  const hit = (j.results ?? []).find((r: { name?: string; title?: string; overview?: string }) =>
    norm(r.name ?? r.title ?? "") === norm(show) && r.overview) ?? (j.results ?? []).find((r: { overview?: string }) => r.overview);
  if (!hit?.overview) return null;
  return { text: shorten(hit.overview), source: "tmdb", url: `https://www.themoviedb.org/${path}/${hit.id}` };
}

const TV_WORDS = /television|tv series|series|show|docuseries|documentary|programme|sitcom|serial|anime|miniseries|drama|reality|game show/i;
const FILM_WORDS = /film|movie|documentary/i;

async function fromWikipedia(show: string, kind: "tv" | "film"): Promise<Description | null> {
  const hint = kind === "tv" ? "TV series" : "film";
  const s = await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=5&format=json&srsearch=${encodeURIComponent(`${show} ${hint}`)}`);
  const want = norm(show);
  const candidates: string[] = (s.query?.search ?? []).map((r: { title: string }) => r.title)
    .filter((t: string) => norm(t.replace(/\s*\(.*\)$/, "")) === want);
  for (const title of candidates) {
    const p = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
    if (p.type === "disambiguation" || !p.extract) continue;
    const words = kind === "tv" ? TV_WORDS : FILM_WORDS;
    const firstSentence = p.extract.split(/(?<=[.!?])\s/)[0];
    // Must read as a show/film in its opening sentence, and be a Netflix title (avoids same-name shows and people)
    if (!words.test(`${p.description ?? ""} ${firstSentence}`) || !/netflix/i.test(p.extract)) continue;
    return { text: shorten(p.extract), source: "wikipedia", url: p.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` };
  }
  return null;
}

export async function fetchDescription(show: string, kind: "tv" | "film"): Promise<Description | null> {
  for (const f of [fromTmdb, fromWikipedia]) {
    try { const d = await f(show, kind); if (d) return d; } catch (e) { console.warn("description", show, String(e)); }
  }
  return null;
}
