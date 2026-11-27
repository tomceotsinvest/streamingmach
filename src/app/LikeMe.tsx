"use client";
// "Best for …" sentence filter at the top of the chart. Each highlighted phrase is a native select,
// so it stays keyboard- and screen-reader-friendly; genres and tastes sit under "More about me".
import { useState } from "react";
import type { Profile } from "@/lib/match";
import { profileIsSet } from "@/lib/match";
import { AGE_BANDS, GENRES, AREA_GROUPS, LIVES_WITH, TV_DIET, ATTITUDE_KEYS, AttitudeKey } from "@/lib/questionnaire";
import { TASTE_LABELS } from "./Dashboard";

const MAX_GENRES = 3;
const AREA_PHRASE = ["London", "the South & East", "the Midlands", "the North", "Scotland, Wales or NI"];
const LIVES_PHRASE = ["on their own", "with a partner", "with housemates or family"];
const DIET_PHRASE = ["a little TV", "a fair bit of TV", "a lot of TV"];

function Pick({ label, value, onChange, options, empty }: {
  label: string; value: string; onChange: (v: string) => void; options: [string, string][]; empty: string;
}) {
  const shown = options.find(([v]) => v === value)?.[1] ?? empty;
  return (
    <span className={`lm-pick ${value ? "set" : ""}`}>
      <span aria-hidden="true">{shown}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{empty}</option>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </span>
  );
}

function listPhrase(xs: string[]) {
  const l = xs.map((x) => x.toLowerCase());
  return l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}`;
}

export function LikeMe({ profile, onChange, matched }: { profile: Profile; onChange: (p: Profile) => void; matched?: number }) {
  const [more, setMore] = useState(false);
  const set = profileIsSet(profile);
  const genres = profile.genres ?? [];
  const tastes = profile.tastes ?? [];
  const num = (v: string) => (v === "" ? undefined : Number(v));
  const toggleGenre = (g: string) =>
    onChange({ ...profile, genres: genres.includes(g) ? genres.filter((x) => x !== g) : genres.length >= MAX_GENRES ? genres : [...genres, g] });
  const toggleTaste = (k: AttitudeKey) =>
    onChange({ ...profile, tastes: tastes.includes(k) ? tastes.filter((x) => x !== k) : [...tastes, k] });

  return (
    <section className="lm" aria-label="Rank the chart for people like me">
      <div className="lm-row">
        <p className="lm-sentence">
          Best for{" "}
          <Pick label="I'm a" empty="anyone" value={profile.gender ?? ""} onChange={(v) => onChange({ ...profile, gender: (v || undefined) as Profile["gender"] })}
            options={[["Woman", "a woman"], ["Man", "a man"]]} />
          {" "}aged{" "}
          <Pick label="Age" empty="any age" value={profile.ageBand ?? ""} onChange={(v) => onChange({ ...profile, ageBand: (v || undefined) as Profile["ageBand"] })}
            options={AGE_BANDS.map((a) => [a, a.replace("-", "–")])} />
          ,{" "}
          <Pick label="Kids at home" empty="with or without kids" value={profile.kids == null ? "" : profile.kids ? "y" : "n"}
            onChange={(v) => onChange({ ...profile, kids: v === "" ? undefined : v === "y" })} options={[["y", "with kids"], ["n", "without kids"]]} />
          , in{" "}
          <Pick label="Where I live" empty="anywhere in the UK" value={profile.area == null ? "" : String(profile.area)}
            onChange={(v) => onChange({ ...profile, area: num(v) })} options={AREA_GROUPS.map((_, i) => [String(i), AREA_PHRASE[i]])} />
          , who likes{" "}
          <button type="button" className={`lm-pick lm-btn ${genres.length ? "set" : ""}`} aria-expanded={more} onClick={() => setMore(!more)}>
            {genres.length ? listPhrase(genres) : "any genre"}
          </button>
          {(profile.livesWith != null || profile.tvDiet != null) && <>
            {profile.livesWith != null && <>, living {LIVES_PHRASE[profile.livesWith]}</>}
            {profile.tvDiet != null && <>, watching {DIET_PHRASE[profile.tvDiet]}</>}
          </>}
          .
        </p>
        <div className="lm-side">
          <button type="button" className="lm-more" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Done" : "+ More about me"}</button>
          <span className="lm-note">
            {set ? <>Re-ranked using ~{matched ?? 0} viewers like you · <button type="button" className="lm-clear" onClick={() => onChange({})}>Clear</button></>
              : "Saved on this device only. No account needed."}
          </span>
        </div>
      </div>

      {more && (
        <div className="lm-panel">
          <div className="lm-group">
            <span className="lm-label">Genres I like <small>(up to {MAX_GENRES})</small></span>
            <div className="lm-chips">{GENRES.map((g) => <button key={g} type="button" aria-pressed={genres.includes(g)} className={genres.includes(g) ? "on" : ""} onClick={() => toggleGenre(g)}>{g}</button>)}</div>
          </div>
          <div className="lm-group lm-selects">
            <label><span className="lm-label">I live</span>
              <select value={profile.livesWith ?? ""} onChange={(e) => onChange({ ...profile, livesWith: num(e.target.value) })}>
                <option value="">—</option>{LIVES_WITH.map((a, i) => <option key={a} value={i}>{a}</option>)}</select></label>
            <label><span className="lm-label">How much I watch</span>
              <select value={profile.tvDiet ?? ""} onChange={(e) => onChange({ ...profile, tvDiet: num(e.target.value) })}>
                <option value="">—</option>{TV_DIET.map((a, i) => <option key={a} value={i}>{a}</option>)}</select></label>
          </div>
          <div className="lm-group">
            <span className="lm-label">Sounds like me</span>
            <div className="lm-chips">{ATTITUDE_KEYS.map((k) => <button key={k} type="button" aria-pressed={tastes.includes(k)} className={tastes.includes(k) ? "on" : ""} onClick={() => toggleTaste(k)}>{TASTE_LABELS[k]}</button>)}</div>
          </div>
        </div>
      )}
    </section>
  );
}
