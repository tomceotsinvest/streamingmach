// Netflix official Top 10 feed. Netflix publishes static TSVs, updated weekly (usually Tuesday).
// Columns in all-weeks-countries.tsv:
// country_name, country_iso2, week, category, weekly_rank, show_title, season_title, cumulative_weeks_in_top_10

export const NETFLIX_COUNTRIES_TSV =
  process.env.NETFLIX_TSV_URL ?? "https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv";

export type ChartRow = {
  week: string;            // YYYY-MM-DD (week ending)
  kind: "tv" | "film";
  rank: number;
  showTitle: string;
  seasonTitle: string | null;
  weeksInTop10: number;
};

export type ChartTitle = { id: string; kind: "tv" | "film"; name: string; showTitle: string };

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function titleFromRow(r: ChartRow): ChartTitle {
  const name = r.seasonTitle ?? r.showTitle;
  return { id: `${r.kind}-${slugify(name)}`, kind: r.kind, name, showTitle: r.showTitle };
}

/** Parse the countries TSV, keeping only one country. Tolerant of column order (reads the header). */
export function parseCountryTsv(tsv: string, iso2 = "GB"): ChartRow[] {
  const lines = tsv.split(/\r?\n/);
  const header = lines[0].split("\t").map((h) => h.trim());
  const col = (n: string) => {
    const i = header.indexOf(n);
    if (i < 0) throw new Error(`Netflix TSV is missing column "${n}" — the feed format may have changed`);
    return i;
  };
  const c = {
    iso: col("country_iso2"), week: col("week"), cat: col("category"), rank: col("weekly_rank"),
    show: col("show_title"), season: col("season_title"), cum: col("cumulative_weeks_in_top_10"),
  };
  const rows: ChartRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const f = line.split("\t");
    if (f[c.iso] !== iso2) continue;
    const cat = (f[c.cat] ?? "").toLowerCase();
    const kind = cat.startsWith("tv") ? "tv" : cat.startsWith("film") ? "film" : null;
    if (!kind) continue;
    const season = (f[c.season] ?? "").trim();
    rows.push({
      week: f[c.week].slice(0, 10),
      kind,
      rank: Number(f[c.rank]),
      showTitle: f[c.show].trim(),
      seasonTitle: season && season !== "N/A" ? season : null,
      weeksInTop10: Number(f[c.cum]) || 0,
    });
  }
  return rows;
}

/** The latest chart week plus the week before (for 14-day carry-over of titles that just dropped out). */
export function latestWeeks(rows: ChartRow[], n = 2): string[] {
  return [...new Set(rows.map((r) => r.week))].sort().reverse().slice(0, n);
}

/**
 * Titles for today's survey: everything in the latest UK top 10 TV + top 10 films,
 * plus titles from the previous week that dropped out (so their ratings stabilise rather than reset).
 */
export function surveyTitleSet(rows: ChartRow[]): { current: ChartTitle[]; carryOver: ChartTitle[]; week: string } {
  const [latest, previous] = latestWeeks(rows, 2);
  if (!latest) throw new Error("No UK rows found in Netflix feed");
  const byWeek = (w: string | undefined) =>
    rows.filter((r) => r.week === w).sort((a, b) => (a.kind === b.kind ? a.rank - b.rank : a.kind === "tv" ? -1 : 1));
  const current = dedupe(byWeek(latest).map(titleFromRow));
  const currentIds = new Set(current.map((t) => t.id));
  const carryOver = dedupe(byWeek(previous).map(titleFromRow)).filter((t) => !currentIds.has(t.id));
  return { current, carryOver, week: latest };
}

function dedupe(ts: ChartTitle[]): ChartTitle[] {
  const seen = new Set<string>();
  return ts.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

export async function fetchUkChart(): Promise<ChartRow[]> {
  const res = await fetch(NETFLIX_COUNTRIES_TSV, { headers: { "user-agent": "streaming-machine/1.0" }, cache: "no-store" });
  if (!res.ok) throw new Error(`Netflix feed returned ${res.status}`);
  return parseCountryTsv(await res.text(), "GB");
}
