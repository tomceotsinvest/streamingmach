"use client";
import { useEffect, useMemo, useState } from "react";
import type { Snapshot, TitleScore } from "@/lib/scoring";
import { matchScores, profileIsSet, Profile, Match } from "@/lib/match";
import { parseQueryRules, rank, describe, Filters, Ranked } from "@/lib/search";
import { ATTRIBUTES, ATTRIBUTE_KEYS, AttributeKey, OCCASIONS, OCCASION_KEYS, AGE_BANDS, GENRES, AREA_GROUPS, LIVES_WITH, TV_DIET, ATTITUDE_KEYS, AttitudeKey } from "@/lib/questionnaire";

const CATEGORIES: { key: string; label: string; filter: (t: TitleScore) => boolean }[] = [
  { key: "tv", label: "Series", filter: (t) => t.kind === "tv" },
  { key: "film", label: "Films", filter: (t) => t.kind === "film" },
  ...(["gripping", "funny", "moving", "tense", "thoughtful", "easy"] as AttributeKey[]).map((k) => ({
    key: k, label: ATTRIBUTES[k], filter: (t: TitleScore) => (t.attributeIndex[k] ?? 0) >= 105 && (t.attributes[k] ?? 0) >= 3.4,
  })),
  { key: "family", label: "Family-friendly", filter: (t) => (t.kidSafe ?? 0) >= 0.5 },
];
const EXAMPLES = ["Something funny to watch with my kids", "A gripping series to binge", "Something easy for date night", "What's everyone watching?"];
export const PROFILE_KEY = "sm-profile-v1";

export default function Dashboard({ snap, brand, theme }: { snap: Snapshot; brand: string; theme?: string }) {
  const [profile, setProfile] = useState<Profile>({});
  const [tuneOpen, setTuneOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters | null>(null);
  const [searching, setSearching] = useState(false);
  const [cat, setCat] = useState(CATEGORIES[0].key);
  const [open, setOpen] = useState<TitleScore | null>(null);

  useEffect(() => { try { const p = localStorage.getItem(PROFILE_KEY); if (p) setProfile(JSON.parse(p)); } catch {} }, []);
  const saveProfile = (p: Profile) => { setProfile(p); try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch {} };

  const scored = useMemo(() => snap.titles.filter((t) => t.viewerScore != null), [snap]);
  const mine = profileIsSet(profile);
  const matches = useMemo(() => (mine ? matchScores(snap, profile) : undefined), [snap, profile, mine]);
  const score = (t: TitleScore) => matches?.get(t.id)?.matchScore ?? t.viewerScore ?? 0;

  const trending = useMemo(() => [...snap.titles].sort((a, b) => b.momentum - a.momentum).slice(0, 5), [snap]);
  const top = useMemo(() => [...scored].sort((a, b) => b.viewerScore! - a.viewerScore!), [scored]);
  const forYou = useMemo(() => (matches ? [...scored].sort((a, b) => score(b) - score(a)).slice(0, 6) : []), [scored, matches]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasFilms = snap.titles.some((t) => t.kind === "film");
  const cats = hasFilms ? CATEGORIES : CATEGORIES.filter((c) => c.key !== "tv" && c.key !== "film");
  const category = cats.find((c) => c.key === cat) ?? cats[0];
  const inCategory = useMemo(() => [...scored].filter(category.filter).sort((a, b) => score(b) - score(a)), [scored, category, matches]); // eslint-disable-line react-hooks/exhaustive-deps
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
    } catch { /* offline or static preview: rules parser already applied */ }
    setFilters(f); setSearching(false);
  }

  const asOf = new Date(`${snap.snapshotDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="shell" data-theme={theme === "paper" || theme === "clean" ? theme : undefined}>
    <div className="app">
      {snap.demo && <div className="demo">Demo data — fictional titles and synthetic responses, for preview only.</div>}
      {snap.preview && <div className="demo">{snap.preview}</div>}
      <header className="top">
        <div className="brand"><span className="mark" aria-hidden>▶</span>{brand}</div>
        <div className="scope"><span className="pill">Netflix</span><span className="pill muted">UK</span></div>
        <div className="asof">Updated {asOf} · {snap.sample.valid.toLocaleString("en-GB")} viewers this week</div>
      </header>

      <section className="hero">
        <h1>What's actually worth watching on Netflix right now</h1>
        <p className="lede">Ranked by what UK viewers think, not what Netflix is pushing. Rebuilt every day from a fresh survey.</p>
        <form className="search" onSubmit={(e) => { e.preventDefault(); runSearch(query); }}>
          <input aria-label="Describe what you want to watch" placeholder="Describe what you're in the mood for…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="submit" disabled={searching}>{searching ? "Finding…" : "Find"}</button>
        </form>
        <div className="examples">{EXAMPLES.map((x) => <button key={x} onClick={() => runSearch(x)}>{x}</button>)}</div>
      </section>

      {filters && (
        <section className="block">
          <div className="block-head">
            <h2>For “{query}”</h2>
            <button className="link" onClick={() => { setFilters(null); setQuery(""); }}>Clear</button>
          </div>
          <p className="sub">Looking for: {filters.summary || describe(filters)}</p>
          {results.length ? (
            <ol className="rows">{results.map((r, i) => <Row key={r.title.id} n={i + 1} t={r.title} shown={r.base} why={r.why} onOpen={setOpen} />)}</ol>
          ) : <p className="sub">Nothing in this week's chart fits that. Try loosening it.</p>}
        </section>
      )}

      <section className="block">
        <div className="block-head"><h2>Trending</h2><span className="sub">Fastest-growing audience and buzz this week</span></div>
        <div className="cards">{trending.map((t, i) => <Card key={t.id} n={i + 1} t={t} onOpen={setOpen} />)}</div>
      </section>

      <div className="split">
        <section className="block">
          <div className="block-head"><h2>Top rated</h2><span className="sub">Viewer Score, 0–100</span></div>
          <ol className="rows">{top.slice(0, 10).map((t, i) => <Row key={t.id} n={i + 1} t={t} shown={t.viewerScore!} onOpen={setOpen} />)}</ol>
        </section>

        <section className="block you">
          <div className="block-head">
            <h2>For people like you</h2>
            <button className="link" onClick={() => setTuneOpen(!tuneOpen)}>{mine ? "Edit" : "Tune"}</button>
          </div>
          {(tuneOpen || !mine) && <Tune profile={profile} onChange={(p) => { setTuneOpen(true); saveProfile(p); }} onDone={() => setTuneOpen(false)} compact={mine} />}
          {mine && !tuneOpen && (
            <>
              <p className="sub">Scores from viewers who match your profile. Saved on this device only.</p>
              <ol className="rows">{forYou.map((t, i) => <Row key={t.id} n={i + 1} t={t} shown={score(t)} match={matches!.get(t.id)} onOpen={setOpen} />)}</ol>
            </>
          )}
        </section>
      </div>

      <section className="block">
        <div className="block-head"><h2>Top by category</h2></div>
        <div className="tabs" role="tablist">{cats.map((c) => (
          <button key={c.key} role="tab" aria-selected={category.key === c.key} className={category.key === c.key ? "on" : ""} onClick={() => setCat(c.key)}>{c.label}</button>))}</div>
        <div className="cards wrap">{inCategory.slice(0, 10).map((t, i) => <Card key={t.id} n={i + 1} t={t} shownScore={score(t)} onOpen={setOpen} />)}
          {!inCategory.length && <p className="sub">No titles in this category this week.</p>}</div>
      </section>

      <footer className="foot">
        <p><strong>How this works.</strong> Every day we survey UK Netflix viewers about the current UK Top 10 series. Scores combine their rating and how strongly they'd recommend it, weighted to match the UK adult population, over the last 7 days.</p>
        <p>A title needs 100 ratings for a full score; 50–99 shows as Early. ± is the 95% margin of error. Week window {snap.window.from} to {snap.window.to}; effective sample {snap.sample.effectiveN.toLocaleString("en-GB")}. Not affiliated with Netflix.</p>
      </footer>

      {open && <Drawer t={open} match={matches?.get(open.id)} onClose={() => setOpen(null)} />}
    </div>
    </div>
  );
}

function ScoreBadge({ v, early, ci }: { v: number | null; early?: boolean; ci?: number | null }) {
  if (v == null) return <span className="score none">New</span>;
  const tone = v >= 65 ? "hi" : v >= 45 ? "mid" : "lo";
  return <span className={`score ${tone}`} title={ci ? `± ${ci}` : undefined}>{Math.round(v)}{early && <em>Early</em>}</span>;
}

function Card({ t, n, onOpen, shownScore }: { t: TitleScore; n: number; onOpen: (t: TitleScore) => void; shownScore?: number }) {
  return (
    <button className="card" onClick={() => onOpen(t)}>
      <div className="card-top"><span className="rank">{n}</span><ScoreBadge v={shownScore ?? t.viewerScore} early={t.status === "early"} /></div>
      <div className="card-name">{t.name}</div>
      <div className="card-meta">{t.kind === "tv" ? "Series" : "Film"}{t.chartRank ? ` · #${t.chartRank} UK ${t.kind === "tv" ? "series" : "films"} chart` : ""}</div>
      <div className="card-foot">
        {t.reachChange != null && t.reachChange > 0.5
          ? <span className="up">▲ {t.reachChange.toFixed(0)} pts reach</span>
          : <span className="muted">{Math.round(t.reach * 100)}% have watched</span>}
      </div>
      {t.tags.length > 0 && <div className="tags">{t.tags.map((k) => <span key={k}>{ATTRIBUTES[k]}</span>)}</div>}
    </button>
  );
}

function Row({ t, n, shown, why, match, onOpen }: { t: TitleScore; n: number; shown: number; why?: string[]; match?: Match; onOpen: (t: TitleScore) => void }) {
  return (
    <li>
      <button className="row" onClick={() => onOpen(t)}>
        <span className="rank">{n}</span>
        <span className="row-main">
          <span className="row-name">{t.name}</span>
          <span className="row-meta">
            {t.kind === "tv" ? "Series" : "Film"} · {t.raters.toLocaleString("en-GB")} ratings
            {match && Math.abs(match.lift) >= 1 && <span className={match.lift > 0 ? "up" : "down"}> · {match.lift > 0 ? "+" : ""}{match.lift.toFixed(0)} vs everyone</span>}
          </span>
          {why && why.length > 0 && <span className="why">{why.slice(0, 2).join(" · ")}</span>}
        </span>
        <span className="bar"><span style={{ width: `${Math.max(4, Math.min(100, shown))}%` }} /></span>
        <ScoreBadge v={t.viewerScore == null ? null : shown} early={t.status === "early"} ci={t.ci95} />
      </button>
    </li>
  );
}

export const TASTE_LABELS: Record<AttitudeKey, string> = {
  british: "I prefer British shows", subtitles: "Happy with subtitles", short: "I like short series",
  noViolence: "I avoid graphic violence", recs: "I watch what others recommend", finisher: "I finish what I start",
};

export function Tune({ profile, onChange, onDone, compact }: { profile: Profile; onChange: (p: Profile) => void; onDone: () => void; compact: boolean }) {
  const toggleGenre = (g: string) => {
    const gs = profile.genres ?? [];
    onChange({ ...profile, genres: gs.includes(g) ? gs.filter((x) => x !== g) : gs.length >= 3 ? gs : [...gs, g] });
  };
  const toggleTaste = (k: AttitudeKey) => {
    const ts = profile.tastes ?? [];
    onChange({ ...profile, tastes: ts.includes(k) ? ts.filter((x) => x !== k) : [...ts, k] });
  };
  return (
    <div className="tune">
      {!compact && <p className="sub">Tell us a little about you and we'll re-rank everything using viewers like you. Nothing leaves your browser.</p>}
      <label>Age<select value={profile.ageBand ?? ""} onChange={(e) => onChange({ ...profile, ageBand: (e.target.value || undefined) as Profile["ageBand"] })}>
        <option value="">—</option>{AGE_BANDS.map((a) => <option key={a}>{a}</option>)}</select></label>
      <label>I'm a<select value={profile.gender ?? ""} onChange={(e) => onChange({ ...profile, gender: (e.target.value || undefined) as Profile["gender"] })}>
        <option value="">—</option><option>Woman</option><option>Man</option></select></label>
      <label>Kids at home<select value={profile.kids == null ? "" : profile.kids ? "y" : "n"} onChange={(e) => onChange({ ...profile, kids: e.target.value === "" ? undefined : e.target.value === "y" })}>
        <option value="">—</option><option value="y">Yes</option><option value="n">No</option></select></label>
      <label>Where I live<select value={profile.area ?? ""} onChange={(e) => onChange({ ...profile, area: e.target.value === "" ? undefined : Number(e.target.value) })}>
        <option value="">—</option>{AREA_GROUPS.map((a, i) => <option key={a} value={i}>{a}</option>)}</select></label>
      <label>I live<select value={profile.livesWith ?? ""} onChange={(e) => onChange({ ...profile, livesWith: e.target.value === "" ? undefined : Number(e.target.value) })}>
        <option value="">—</option>{LIVES_WITH.map((a, i) => <option key={a} value={i}>{a}</option>)}</select></label>
      <label>How much I watch<select value={profile.tvDiet ?? ""} onChange={(e) => onChange({ ...profile, tvDiet: e.target.value === "" ? undefined : Number(e.target.value) })}>
        <option value="">—</option>{TV_DIET.map((a, i) => <option key={a} value={i}>{a}</option>)}</select></label>
      <div className="genres"><span>Favourite genres (up to 3)</span>
        <div>{GENRES.map((g) => <button key={g} className={(profile.genres ?? []).includes(g) ? "on" : ""} onClick={() => toggleGenre(g)}>{g}</button>)}</div>
      </div>
      <div className="genres"><span>Sounds like me</span>
        <div>{ATTITUDE_KEYS.map((k) => <button key={k} className={(profile.tastes ?? []).includes(k) ? "on" : ""} onClick={() => toggleTaste(k)}>{TASTE_LABELS[k]}</button>)}</div>
      </div>
      <div className="tune-actions">
        {profileIsSet(profile) && <button className="primary" onClick={onDone}>Show my picks</button>}
        {profileIsSet(profile) && <button className="link" onClick={() => onChange({})}>Reset</button>}
      </div>
    </div>
  );
}

export function Drawer({ t, match, onClose }: { t: TitleScore; match?: Match; onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const pct = (x: number | null | undefined) => (x == null ? "–" : `${Math.round(x * 100)}%`);
  const occ = OCCASION_KEYS.map((k) => ({ k, v: t.occasions[k] ?? 0 })).sort((a, b) => b.v - a.v).slice(0, 3);
  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-label={t.name} onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
        <p className="kicker">{t.kind === "tv" ? "Series" : "Film"}{t.chartRank ? ` · #${t.chartRank} in the UK Netflix ${t.kind === "tv" ? "series" : "films"} chart` : ""}</p>
        <h2>{t.name}</h2>
        {t.description && <p className="desc">{t.description}{t.descriptionUrl && <> <a href={t.descriptionUrl} target="_blank" rel="noopener noreferrer" className="muted">{t.descriptionSource === "tmdb" ? "TMDB" : "Wikipedia"}</a></>}</p>}
        {t.viewerScore == null ? (
          <p className="sub">Too new to score — {t.raters} ratings so far. Scores appear at 50.</p>
        ) : (
          <div className="big">
            <ScoreBadge v={t.viewerScore} early={t.status === "early"} />
            <div>
              <div className="big-label">Viewer Score <span className="muted">± {t.ci95} · {t.raters.toLocaleString("en-GB")} ratings</span></div>
              {match && <div className="big-label">For people like you: <strong>{Math.round(match.matchScore)}</strong> <span className="muted">from ~{match.matchedRaters} similar viewers</span></div>}
              {t.scoreChange != null && t.scoreChange !== 0 && <div className={t.scoreChange > 0 ? "up" : "down"}>{t.scoreChange > 0 ? "▲" : "▼"} {Math.abs(t.scoreChange)} since yesterday</div>}
            </div>
          </div>
        )}
        <dl className="stats">
          <div><dt>Average rating</dt><dd>{t.avgRating?.toFixed(1) ?? "–"}<small>/10</small></dd></div>
          <div><dt>Net recommend</dt><dd>{t.netRecommend != null ? (t.netRecommend > 0 ? "+" : "") + t.netRecommend : "–"}</dd></div>
          <div><dt>Have watched</dt><dd>{pct(t.reach)}</dd></div>
          <div><dt>Stick with it</dt><dd>{pct(t.completion)}</dd></div>
        </dl>
        {t.viewerScore != null && (
          <>
            <h3>What it's like</h3>
            <div className="attrs">{ATTRIBUTE_KEYS.filter((k) => t.attributes[k] != null).sort((a, b) => (t.attributeIndex[b] ?? 0) - (t.attributeIndex[a] ?? 0)).map((k) => (
              <div key={k} className="attr"><span>{ATTRIBUTES[k]}</span><span className="attr-bar"><span style={{ width: `${((t.attributes[k]! - 1) / 4) * 100}%` }} /></span><span className="muted">{t.attributes[k]!.toFixed(1)}</span></div>
            ))}</div>
            <h3>Best for</h3>
            <p>{occ.map((o) => `${OCCASIONS[o.k]} (${Math.round(o.v * 100)}%)`).join(" · ")}</p>
            {t.kidSafe != null && <p className="muted">{Math.round(t.kidSafe * 100)}% of viewers say it's fine with under-12s.</p>}
            {t.lovedBy && t.leastLovedBy && (
              <>
                <h3>Who loves it</h3>
                <p>Highest with <strong>{t.lovedBy.segment.replace("Age ", "ages ")}</strong> ({t.lovedBy.score}); lowest with <strong>{t.leastLovedBy.segment.replace("Age ", "ages ")}</strong> ({t.leastLovedBy.score}).</p>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
