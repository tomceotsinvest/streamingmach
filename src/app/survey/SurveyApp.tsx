"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  REGIONS, SERVICES, HOURS, VIEW_STATUS, ViewStatus, STOP_REASONS, HEARD_VIA, WATCHED_WITH, LOYALTY,
  ATTRIBUTES, ATTRIBUTE_KEYS, OCCASIONS, OCCASION_KEYS, KID_SAFE, GENDERS, HOUSEHOLD, OCCUPATION, GENRES,
  ATTITUDES, ATTENTION_CHECK,
} from "@/lib/questionnaire";
import { allocateDeepDives } from "@/lib/allocation";
import { DECOY_ID, isEligible } from "@/lib/submission";

type Title = { id: string; name: string; kind: "tv" | "film" };
type Config = { waveId: number; titles: Title[]; decoy: string; raterCounts: Record<string, number>; blocked?: boolean };
type Rating = {
  titleId: string; rating?: number; recommend?: number; watchedWith: string[]; loyalty: string | null;
  attributes: Record<string, number>; occasions: string[]; kidSafe: "yes" | "older" | "no" | null;
};

function shuffle<T>(xs: T[], seed: number): T[] {
  const a = [...xs]; let s = seed || 1;
  for (let i = a.length - 1; i > 0; i--) { s = (s * 9301 + 49297) % 233280; const j = Math.floor((s / 233280) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export default function SurveyApp() {
  const q = useSearchParams();
  const waveId = Number(q.get("wave"));
  const pid = q.get("PROLIFIC_PID");
  const sessionId = q.get("SESSION_ID");

  const [cfg, setCfg] = useState<Config | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [startedAt] = useState(() => new Date().toISOString());
  const [page, setPage] = useState<string>("intro");
  const [busy, setBusy] = useState(false);

  // Answers
  const [age, setAge] = useState("");
  const [region, setRegion] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [hours, setHours] = useState("");
  const [viewing, setViewing] = useState<Record<string, ViewStatus>>({});
  const [stopReasons, setStopReasons] = useState<Record<string, string>>({});
  const [plans, setPlans] = useState<string[]>([]);
  const [heardVia, setHeardVia] = useState<Record<string, string>>({});
  const [deep, setDeep] = useState<string[]>([]);
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [gender, setGender] = useState("");
  const [household, setHousehold] = useState<string[]>([]);
  const [grade, setGrade] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [attitudes, setAttitudes] = useState<Record<string, number>>({});
  const [bestTitle, setBestTitle] = useState("");
  const [attention, setAttention] = useState("");

  useEffect(() => {
    if (!waveId) { setErr("This survey link is missing its wave. Please return to Prolific."); return; }
    fetch(`/api/survey/config?wave=${waveId}${pid ? `&pid=${encodeURIComponent(pid)}` : ""}`)
      .then((r) => r.json()).then((c) => (c.error ? setErr(c.error) : setCfg(c))).catch(() => setErr("Could not load the survey."));
  }, [waveId, pid]);

  const seed = useMemo(() => Number(startedAt.replace(/\D/g, "").slice(-6)), [startedAt]);
  const grid: Title[] = useMemo(() => {
    if (!cfg) return [];
    return shuffle([...cfg.titles, { id: DECOY_ID, name: cfg.decoy, kind: "tv" as const }], seed);
  }, [cfg, seed]);
  const titleName = (id: string) => cfg?.titles.find((t) => t.id === id)?.name ?? id;

  const toggle = (xs: string[], x: string, max = 99) => (xs.includes(x) ? xs.filter((y) => y !== x) : xs.length >= max ? xs : [...xs, x]);

  const stoppedIds = Object.entries(viewing).filter(([id, s]) => s === "stopped" && id !== DECOY_ID).map(([id]) => id);
  const heardIds = Object.entries(viewing).filter(([id, s]) => s === "heard" && id !== DECOY_ID).map(([id]) => id);
  const viaIds = useMemo(() => {
    const watchingNow = Object.entries(viewing).filter(([id, s]) => s === "watching" && id !== DECOY_ID).map(([id]) => id);
    return [...plans, ...watchingNow].slice(0, 3);
  }, [viewing, plans]);

  async function screenOut() {
    setBusy(true);
    await fetch("/api/survey/submit", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screenedOut: true, waveId, prolificPid: pid, sessionId, startedAt }) }).catch(() => {});
    setPage("screened"); setBusy(false);
  }

  function afterScreener() {
    const a = Number(age);
    if (!isEligible({ age: a, services })) return screenOut();
    setPage("grid");
  }

  function afterGrid() {
    const alloc = allocateDeepDives(
      Object.fromEntries(Object.entries(viewing).filter(([id]) => id !== DECOY_ID)), cfg!.raterCounts);
    setDeep(alloc);
    setRatings(Object.fromEntries(alloc.map((id) => [id, { titleId: id, watchedWith: [], loyalty: null, attributes: {}, occasions: [], kidSafe: null }])));
    setPage(stoppedIds.length || heardIds.length ? "followups" : alloc.length ? "deep-0" : "profile");
  }

  async function submit() {
    setBusy(true); setErr(null);
    const body = {
      waveId, prolificPid: pid, sessionId, startedAt,
      screener: { age: Number(age), region, services, hours },
      viewing, stopReasons, plans, heardVia,
      ratings: deep.map((id) => ratings[id]),
      profile: { gender, household, grade, genres, attitudes, bestTitle: bestTitle || null, attention },
    };
    const res = await fetch("/api/survey/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (j.redirect) { setPage("done"); window.location.href = j.redirect; return; }
    setErr("Something went wrong saving your answers. Please check every question is answered and try again.");
    setBusy(false);
  }

  if (err && !cfg) return <Shell><p className="s-note">{err}</p></Shell>;
  if (!cfg) return <Shell><p className="s-note">Loading…</p></Shell>;
  if (cfg.blocked) return <Shell><h1>Thanks, you've taken part recently</h1><p>You can only take this survey once a week. Please return the study on Prolific so you aren't timed out.</p></Shell>;

  const deepIndex = page.startsWith("deep-") ? Number(page.slice(5)) : -1;
  const steps = 4 + deep.length;
  const stepNo = page === "screener" ? 1 : page === "grid" ? 2 : page === "followups" ? 3 : deepIndex >= 0 ? 4 + deepIndex : page === "profile" ? steps : 0;

  return (
    <Shell progress={stepNo ? stepNo / steps : 0}>
      {page === "intro" && (
        <>
          <h1>What have you been watching on Netflix?</h1>
          <p>We'll ask which of this week's most popular Netflix shows and films you've seen, and what you thought of a few of them. It takes about 8 minutes.</p>
          <p className="s-note">Your answers are anonymous and used only to rank shows for a public guide to what's worth watching. We don't collect your name or contact details.</p>
          <Next onClick={() => setPage("screener")}>Start</Next>
        </>
      )}

      {page === "screener" && (
        <>
          <Q n="1" label="How old are you?">
            <input className="s-input" type="number" inputMode="numeric" min={16} max={110} value={age} onChange={(e) => setAge(e.target.value)} />
          </Q>
          <Q n="2" label="Where do you live?">
            <select className="s-input" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">Choose…</option>{REGIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Q>
          <Q n="3" label="Which of these services can you watch at home?" hint="Select all that apply">
            <Chips options={[...SERVICES]} value={services} onToggle={(x) => setServices(x === "None of these" ? ["None of these"] : toggle(services.filter((s) => s !== "None of these"), x))} />
          </Q>
          <Q n="4" label="In a typical week, how many hours do you spend watching streamed TV and films?">
            <Radio options={[...HOURS]} value={hours} onChange={setHours} />
          </Q>
          <Next disabled={!age || !region || !services.length || !hours || busy} onClick={afterScreener}>Continue</Next>
        </>
      )}

      {page === "grid" && (
        <>
          <h2>Which of these have you watched on Netflix?</h2>
          <p className="s-note">One answer for each. Seasons count separately.</p>
          <div className="s-grid">
            <div className="s-grid-head"><span />{Object.values(VIEW_STATUS).map((l) => <span key={l}>{l}</span>)}</div>
            {grid.map((t) => (
              <div className="s-grid-row" key={t.id}>
                <span className="s-title">{t.name}<em>{t.kind === "tv" ? "Series" : "Film"}</em></span>
                {(Object.keys(VIEW_STATUS) as ViewStatus[]).map((s) => (
                  <label key={s} className="s-cell" title={VIEW_STATUS[s]}>
                    <input type="radio" name={`v-${t.id}`} checked={viewing[t.id] === s} onChange={() => setViewing({ ...viewing, [t.id]: s })} />
                    <span className="s-cell-label">{VIEW_STATUS[s]}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
          <Next disabled={grid.some((t) => !viewing[t.id])} onClick={afterGrid}>Continue</Next>
        </>
      )}

      {page === "followups" && (
        <>
          {stoppedIds.length > 0 && (
            <Q label="Why did you stop watching?">
              {stoppedIds.map((id) => (
                <div key={id} className="s-sub"><strong>{titleName(id)}</strong>
                  <Radio options={[...STOP_REASONS]} value={stopReasons[id] ?? ""} onChange={(v) => setStopReasons({ ...stopReasons, [id]: v })} /></div>
              ))}
            </Q>
          )}
          {heardIds.length > 0 && (
            <Q label="Which of these are you planning to watch?" hint="Select any">
              <Chips options={heardIds.map(titleName)} value={plans.map(titleName)} onToggle={(name) => {
                const id = heardIds.find((h) => titleName(h) === name)!; setPlans(toggle(plans, id)); }} />
            </Q>
          )}
          {viaIds.length > 0 && (
            <Q label="Where did you first hear about it?">
              {viaIds.map((id) => (
                <div key={id} className="s-sub"><strong>{titleName(id)}</strong>
                  <Radio options={[...HEARD_VIA]} value={heardVia[id] ?? ""} onChange={(v) => setHeardVia({ ...heardVia, [id]: v })} /></div>
              ))}
            </Q>
          )}
          <Next disabled={stoppedIds.some((id) => !stopReasons[id]) || viaIds.some((id) => !heardVia[id])}
            onClick={() => setPage(deep.length ? "deep-0" : "profile")}>Continue</Next>
        </>
      )}

      {deepIndex >= 0 && (() => {
        const id = deep[deepIndex]; const r = ratings[id];
        const set = (patch: Partial<Rating>) => setRatings({ ...ratings, [id]: { ...r, ...patch } });
        const complete = r.rating && r.recommend != null && r.loyalty && ATTRIBUTE_KEYS.every((k) => r.attributes[k]) && r.kidSafe && r.watchedWith.length;
        return (
          <>
            <p className="s-kicker">Title {deepIndex + 1} of {deep.length}</p>
            <h2>{titleName(id)}</h2>
            <Q label="Overall, how would you rate it?" hint="1 = terrible, 10 = brilliant">
              <Scale from={1} to={10} value={r.rating} onChange={(v) => set({ rating: v })} />
            </Q>
            <Q label="How likely are you to recommend it to a friend with similar taste?" hint="0 = not at all, 10 = extremely likely">
              <Scale from={0} to={10} value={r.recommend} onChange={(v) => set({ recommend: v })} />
            </Q>
            <Q label="Who did you watch it with?" hint="Select all that apply">
              <Chips options={[...WATCHED_WITH]} value={r.watchedWith} onToggle={(x) => set({ watchedWith: toggle(r.watchedWith, x) })} />
            </Q>
            <Q label="Would you watch another season, or something like it?">
              <Radio options={[...LOYALTY]} value={r.loyalty ?? ""} onChange={(v) => set({ loyalty: v })} />
            </Q>
            <Q label="How well do these describe it?" hint="1 = not at all, 5 = completely">
              <div className="s-attr">
                {ATTRIBUTE_KEYS.map((k) => (
                  <div className="s-attr-row" key={k}><span>{ATTRIBUTES[k]}</span>
                    <Scale from={1} to={5} value={r.attributes[k]} onChange={(v) => set({ attributes: { ...r.attributes, [k]: v } })} compact /></div>
                ))}
              </div>
            </Q>
            <Q label="When is it best to watch?" hint="Pick up to 3">
              <Chips options={OCCASION_KEYS.map((k) => OCCASIONS[k])} value={r.occasions.map((k) => OCCASIONS[k as keyof typeof OCCASIONS])}
                onToggle={(label) => { const k = OCCASION_KEYS.find((o) => OCCASIONS[o] === label)!; set({ occasions: toggle(r.occasions, k, 3) }); }} />
            </Q>
            <Q label="Is it suitable to watch with children under 12?">
              <Radio options={Object.values(KID_SAFE)} value={r.kidSafe ? KID_SAFE[r.kidSafe] : ""}
                onChange={(v) => set({ kidSafe: (Object.keys(KID_SAFE) as (keyof typeof KID_SAFE)[]).find((k) => KID_SAFE[k] === v)! })} />
            </Q>
            <Next disabled={!complete} onClick={() => { window.scrollTo(0, 0); setPage(deepIndex + 1 < deep.length ? `deep-${deepIndex + 1}` : "profile"); }}>Continue</Next>
          </>
        );
      })()}

      {page === "profile" && (
        <>
          <h2>A little about you</h2>
          <p className="s-note">This lets us show people recommendations from viewers like them.</p>
          <Q label="Which best describes you?"><Radio options={[...GENDERS]} value={gender} onChange={setGender} /></Q>
          <Q label="Who lives in your household?" hint="Select all that apply">
            <Chips options={[...HOUSEHOLD]} value={household} onToggle={(x) => setHousehold(toggle(household, x))} />
          </Q>
          <Q label="Which best describes the occupation of the main earner in your household?">
            <Radio options={Object.values(OCCUPATION)} value={grade ? OCCUPATION[grade as keyof typeof OCCUPATION] : ""}
              onChange={(v) => setGrade((Object.keys(OCCUPATION) as (keyof typeof OCCUPATION)[]).find((k) => OCCUPATION[k] === v)!)} />
          </Q>
          <Q label="Which genres do you enjoy most?" hint="Pick up to 5">
            <Chips options={[...GENRES]} value={genres} onToggle={(x) => setGenres(toggle(genres, x, 5))} />
          </Q>
          <Q label="How much do you agree?" hint="1 = strongly disagree, 5 = strongly agree">
            <div className="s-attr">
              {Object.entries(ATTITUDES).map(([k, label]) => (
                <div className="s-attr-row" key={k}><span>{label}</span>
                  <Scale from={1} to={5} value={attitudes[k]} onChange={(v) => setAttitudes({ ...attitudes, [k]: v })} compact /></div>
              ))}
            </div>
          </Q>
          <Q label="What's the best thing you've streamed in the last 12 months?" hint="Optional — any service">
            <input className="s-input" value={bestTitle} maxLength={120} onChange={(e) => setBestTitle(e.target.value)} />
          </Q>
          <Q label={ATTENTION_CHECK.prompt}><Radio options={[...ATTENTION_CHECK.options]} value={attention} onChange={setAttention} /></Q>
          {err && <p className="s-error">{err}</p>}
          <Next disabled={busy || !gender || !household.length || !grade || !genres.length || Object.keys(attitudes).length < Object.keys(ATTITUDES).length || !attention}
            onClick={submit}>{busy ? "Saving…" : "Finish"}</Next>
        </>
      )}

      {page === "screened" && (<><h1>Thanks for your time</h1><p>This survey is for UK adults who can watch Netflix, so it isn't a match this time. Please return the study on Prolific.</p></>)}
      {page === "done" && (<><h1>Thank you</h1><p>Taking you back to Prolific…</p></>)}
    </Shell>
  );
}

function Shell({ children, progress = 0 }: { children: React.ReactNode; progress?: number }) {
  return (
    <main className="s-shell">
      <div className="s-bar"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <div className="s-card">{children}</div>
    </main>
  );
}
function Q({ n, label, hint, children }: { n?: string; label: string; hint?: string; children: React.ReactNode }) {
  return <section className="s-q"><h3>{n && <span className="s-n">{n}</span>}{label}</h3>{hint && <p className="s-hint">{hint}</p>}{children}</section>;
}
function Next({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button className="s-next" disabled={disabled} onClick={onClick}>{children}</button>;
}
function Radio({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return <div className="s-options">{options.map((o) => (
    <button type="button" key={o} className={`s-opt ${value === o ? "on" : ""}`} onClick={() => onChange(o)}>{o}</button>))}</div>;
}
function Chips({ options, value, onToggle }: { options: string[]; value: string[]; onToggle: (v: string) => void }) {
  return <div className="s-options">{options.map((o) => (
    <button type="button" key={o} className={`s-opt ${value.includes(o) ? "on" : ""}`} onClick={() => onToggle(o)}>{o}</button>))}</div>;
}
function Scale({ from, to, value, onChange, compact }: { from: number; to: number; value?: number; onChange: (v: number) => void; compact?: boolean }) {
  const xs = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return <div className={`s-scale ${compact ? "compact" : ""}`}>{xs.map((x) => (
    <button type="button" key={x} className={`s-pt ${value === x ? "on" : ""}`} onClick={() => onChange(x)}>{x}</button>))}</div>;
}
