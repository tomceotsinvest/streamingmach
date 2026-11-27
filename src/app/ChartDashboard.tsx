"use client";
// Concept C "The Chart", Dusk palette: the live dashboard design chosen on 25 Nov 2026.
import { useEffect, useMemo, useState } from "react";
import type { Snapshot, TitleScore } from "@/lib/scoring";
import { matchScores, profileIsSet, Profile } from "@/lib/match";
import { parseQueryRules, rank, describe, Filters, Ranked } from "@/lib/search";
import { ATTRIBUTES, OCCASIONS, OccasionKey } from "@/lib/questionnaire";
import { Drawer, PROFILE_KEY } from "./Dashboard";
import { LikeMe } from "./LikeMe";
import "./chart.css";

const MOODS: { key: OccasionKey; label: string; query: string }[] = [
  { key: "edge", label: "Edge of your seat", query: "something gripping and tense" },
  { key: "laugh", label: "Need a laugh", query: "something funny" },
  { key: "family", label: "Family night", query: "something to watch with the kids" },
  { key: "unwind", label: "Switch off", query: "something easy to unwind" },
];
const EXAMPLES = ["Something gripping I can finish this weekend", "Funny, to watch with my kids", "Easy to switch off to"];

function scoreTone(v: number) { return v >= 65 ? "good" : v >= 45 ? "mid" : "low"; }
function pad(n: number) { return String(n).padStart(2, "0"); }
function tags(t: TitleScore) { return t.tags.map((k) => ATTRIBUTES[k]).join(", "); }
function kindLabel(t: TitleScore) {
  return `${t.kind === "tv" ? "Series" : "Film"}${t.chartRank ? ` · #${t.chartRank} UK ${t.kind === "tv" ? "series" : "films"} chart` : ""}`;
}
function segmentLabel(s: string) { return s.replace(/^Age /, "viewers aged ").replace("Men", "men").replace("Women", "women"); }

export default function ChartDashboard({ snap, brand }: { snap: Snapshot; brand: string }) {
  const [profile, setProfile] = useState<Profile>({});
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState<TitleScore | null>(null);

  useEffect(() => { try { const p = localStorage.getItem(PROFILE_KEY); if (p) setProfile(JSON.parse(p)); } catch {} }, []);
  const saveProfile = (p: Profile) => { setProfile(p); try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch {} };

  const scored = useMemo(() => snap.titles.filter((t) => t.viewerScore != null), [snap]);
  const climbers = useMemo(() => [...snap.titles].sort((a, b) => b.momentum - a.momentum).slice(0, 5), [snap]);
  const mine = profileIsSet(profile);
  const matches = useMemo(() => (mine ? matchScores(snap, profile) : undefined), [snap, profile, mine]);
  // Everything below the filter ranks by the personal score once a profile is set
  const scoreOf = (t: TitleScore) => matches?.get(t.id)?.matchScore ?? t.viewerScore!;
  const top = useMemo(() => [...scored].sort((a, b) => scoreOf(b) - scoreOf(a)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scored, matches]);
  const hero = top[0];
  const heroMatch = hero ? matches?.get(hero.id) : undefined;
  const lift = (t: TitleScore) => matches?.get(t.id)?.lift ?? 0;
  const moods = useMemo(() => MOODS.map((m) => {
    const fits = scored.filter((t) => (t.occasions[m.key] ?? 0) >= 0.25).sort((a, b) => b.viewerScore! - a.viewerScore!);
    return { ...m, pick: fits[0], more: Math.max(0, fits.length - 1) };
  }), [scored]);
  const results: Ranked[] = useMemo(() => {
    if (!filters) return [];
    const merged = { ...profile, ...filters.profile };
    return rank(snap, filters, profileIsSet(merged) ? matchScores(snap, merged) : undefined).slice(0, 8);
  }, [filters, snap, profile]);

  async function runSearch(q: string) {
    const text = q.trim();
    setQuery(q);
    if (!text) { setFilters(null); return; }
    setSearching(true);
    let f: Filters = parseQueryRules(text);
    try {
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ q: text }) });
      if (res.ok) f = (await res.json()).filters;
    } catch { /* rules parser already applied */ }
    setFilters(f); setSearching(false);
    setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  const asOf = new Date(`${snap.snapshotDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const banner = snap.demo ? "Demo data: fictional titles and synthetic responses, for preview only." : snap.preview;

  return (
    <div className="chart">
      {banner && <div className="c-banner">{banner}</div>}
      <div className="c-wrap">
        <header className="c-strip">
          <span>Netflix · UK</span>
          <span>Updated {asOf}</span>
          <span className="c-muted">{snap.sample.valid.toLocaleString("en-GB")} UK viewers this week</span>
        </header>

        <div className="c-mast">
          <h1>{brand.split(" ")[0]}<br /><span className="c-accent">{brand.split(" ").slice(1).join(" ") || "Machine"}</span></h1>
          <p className="c-lede">The UK's viewer-rated chart. What people actually thought of this week's Netflix series, not what the algorithm is pushing.</p>
        </div>

        <LikeMe profile={profile} onChange={saveProfile} matched={heroMatch?.matchedRaters} />

        <form className="c-search" role="search" onSubmit={(e) => { e.preventDefault(); runSearch(query); }}>
          <label htmlFor="mood">Ask the chart</label>
          <input id="mood" type="search" placeholder={EXAMPLES[0]} value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="submit" disabled={searching}>{searching ? "Finding…" : "Find"}</button>
        </form>
        <div className="c-examples">
          {EXAMPLES.map((x) => <button key={x} type="button" onClick={() => runSearch(x)}>{x}</button>)}
        </div>

        {filters && (
          <section id="results" className="c-results">
            <div className="c-head">
              <h2 className="c-h2">For “{query}”</h2>
              <button type="button" className="c-link" onClick={() => { setFilters(null); setQuery(""); }}>Clear</button>
            </div>
            <p className="c-muted">Looking for: {filters.summary || describe(filters)}</p>
            {results.length ? (
              <ol className="c-list">
                {results.map((r, i) => (
                  <li key={r.title.id}>
                    <button type="button" className="c-row" onClick={() => setOpen(r.title)}>
                      <span className="c-rank">{pad(i + 1)}</span>
                      <span className="c-row-main">
                        <span className="c-row-name">{r.title.name}</span>
                        <span className="c-muted">{r.why.slice(0, 2).join(" · ") || kindLabel(r.title)}</span>
                      </span>
                      <span className={`c-score ${scoreTone(r.base)}`}>{Math.round(r.base)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : <p className="c-muted">Nothing in this week's chart fits that. Try loosening it.</p>}
          </section>
        )}

        <section className="c-hero">
          {hero && (
            <div className="c-hero-main">
              <p className="c-kicker">{mine ? "No. 1 for people like you" : "No. 1 this week"}</p>
              <div className="c-hero-row">
                <button type="button" className="c-giant" onClick={() => setOpen(hero)} aria-label={`${hero.name}, ${mine ? "score for people like you" : "Viewer Score"} ${Math.round(scoreOf(hero))}`}>{Math.round(scoreOf(hero))}</button>
                <div className="c-hero-text">
                  <h2 className="c-hero-title"><button type="button" onClick={() => setOpen(hero)}>{hero.name}</button></h2>
                  <p className="c-body">{kindLabel(hero)} · {hero.raters.toLocaleString("en-GB")} ratings</p>
                  {heroMatch && <p className={`c-lift ${heroMatch.lift >= 1 ? "up" : heroMatch.lift <= -1 ? "down" : ""}`}>
                    {Math.abs(heroMatch.lift) >= 1 ? `${heroMatch.lift > 0 ? "▲" : "▼"} ${Math.abs(Math.round(heroMatch.lift))} vs everyone` : "Same as everyone"} · Viewer Score {Math.round(hero.viewerScore!)}</p>}
                  {hero.description && <p className="c-desc c-desc-hero">{hero.description}</p>}
                  <div className="c-tags">{hero.tags.map((k) => <span key={k}>{ATTRIBUTES[k]}</span>)}</div>
                </div>
              </div>
              <dl className="c-stats">
                <div><dt>Average rating</dt><dd>{hero.avgRating != null ? hero.avgRating.toFixed(1) : "–"}<small>/10</small></dd></div>
                <div><dt>Net recommend</dt><dd>{hero.netRecommend != null ? (hero.netRecommend > 0 ? "+" : "") + Math.round(hero.netRecommend) : "–"}</dd></div>
                <div><dt>Stick with it</dt><dd>{hero.completion != null ? Math.round(hero.completion * 100) : "–"}<small>%</small></dd></div>
              </dl>
              {(hero.lovedBy || hero.kidSafe != null) && (
                <p className="c-hero-note">
                  {hero.lovedBy && <>Rated highest by {segmentLabel(hero.lovedBy.segment)}. </>}
                  {hero.kidSafe != null && (hero.kidSafe < 0.05 ? <>Viewers say it's not one for under-12s.</> : <>{Math.round(hero.kidSafe * 100)}% say it's fine to watch with under-12s.</>)}
                </p>
              )}
            </div>
          )}
          <div className="c-climb">
            <h2 className="c-h3">Climbing</h2>
            <p className="c-muted">Fastest-growing audience this week</p>
            <ol className="c-list">
              {climbers.map((t) => (
                <li key={t.id}>
                  <button type="button" className="c-climb-row" onClick={() => setOpen(t)}>
                    <span className="c-accent c-arrow" aria-hidden="true">▲</span>
                    <span className="c-climb-name">{t.name}</span>
                    <span className="c-climb-up">{t.reachChange != null && t.reachChange > 0 ? `+${Math.round(t.reachChange)} pts` : "New"}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="c-section">
          <div className="c-head">
            <h2 className="c-h1">{mine ? "Your" : "The"} Top {Math.min(20, top.length)}</h2>
            <p className="c-muted c-narrow">{mine ? "Re-ranked by how viewers like you scored each show, out of 100." : "Viewer Score out of 100: how much people rated it, and how strongly they'd recommend it."}</p>
          </div>
          <div className="c-table-wrap">
            <table className="c-table">
              <thead><tr><th scope="col">Rank</th><th scope="col">Series</th><th scope="col">Viewers say</th>{mine ? <th scope="col" className="r">vs everyone</th> : <th scope="col">Ratings</th>}<th scope="col" className="r">{mine ? "For you" : "Score"}</th></tr></thead>
              <tbody>
                {top.slice(0, 20).map((t, i) => (
                  <tr key={t.id}>
                    <td className="c-rank">{pad(i + 1)}</td>
                    <td><button type="button" className="c-tname" onClick={() => setOpen(t)}>{t.name}</button><div className="c-muted c-small">{kindLabel(t)}</div>
                      {t.description && <p className="c-desc">{t.description}</p>}</td>
                    <td className="c-tags-cell">{tags(t) || "–"}</td>
                    {mine
                      ? <td className={`r c-lift ${lift(t) >= 1 ? "up" : lift(t) <= -1 ? "down" : ""}`}>{Math.abs(lift(t)) >= 1 ? `${lift(t) > 0 ? "▲" : "▼"} ${Math.abs(Math.round(lift(t)))}` : "="}</td>
                      : <td className="c-body">{t.raters.toLocaleString("en-GB")}</td>}
                    <td className="r">
                      <span className={`c-score ${scoreTone(scoreOf(t))}`}>{Math.round(scoreOf(t))}</span>
                      {t.status === "early" && <div className="c-early">Early score</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="c-section">
          <h2 className="c-h1">By mood</h2>
          <div className="c-moods">
            {moods.map((m, i) => (
              <button key={m.key} type="button" className={`c-mood m${i}`} onClick={() => runSearch(m.query)}>
                <span className="c-mood-label">{OCCASIONS[m.key]}</span>
                <span>
                  <span className="c-mood-pick">{m.pick?.name ?? "Nothing yet"}</span>
                  {m.pick && <span className="c-mood-meta">Score {Math.round(m.pick.viewerScore!)}{m.more ? ` · ${m.more} more` : ""}</span>}
                </span>
              </button>
            ))}
          </div>
        </section>

        <footer className="c-foot">
          <span>Surveyed daily, weighted to the UK adult population over the last 7 days. A full score needs 100 ratings; 50–99 shows as Early.</span>
          <span>Show descriptions from <a href="https://www.wikipedia.org" className="c-accent">Wikipedia</a> (CC BY-SA){snap.titles.some((t) => t.descriptionSource === "tmdb") && <> and <a href="https://www.themoviedb.org" className="c-accent">TMDB</a>. This product uses the TMDB API but is not endorsed or certified by TMDB</>}.</span>
          <span>Not affiliated with Netflix. · <a href="/uk" className="c-accent">UK Pulse →</a></span>
        </footer>
      </div>
      {open && <Drawer t={open} match={matches?.get(open.id)} onClose={() => setOpen(null)} />}
    </div>
  );
}
