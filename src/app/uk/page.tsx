import type { Metadata } from "next";
import { hasDb, ensureSchema } from "@/lib/db";
import { computePulse, loadPulseRows, demoPulseRows, PulseData } from "@/lib/ukpulse";
import { UK_KEYS, UK_STATEMENTS, UkKey } from "@/lib/questionnaire";
import "../chart.css";
import "./uk.css";

export const dynamic = "force-dynamic"; // small data for now; cache once the history gets long
export const metadata: Metadata = { title: "UK Pulse", description: "How the UK feels, tracked daily." };

const fmtDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtShort = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

async function load(): Promise<{ data: PulseData; demo: boolean; error?: string }> {
  if (!hasDb()) return { data: computePulse(demoPulseRows()), demo: true };
  try { await ensureSchema(); return { data: computePulse(await loadPulseRows()), demo: false }; }
  catch (e) { console.error(e); return { data: computePulse([]), demo: false, error: "unavailable" }; }
}

function Spark({ values, days }: { values: number[]; days: string[] }) {
  const W = 320, H = 84, pad = 4;
  if (values.length < 2) return <div className="u-spark-empty">Trend line appears after a second day of data</div>;
  const lo = Math.max(0, Math.floor((Math.min(...values) - 5) / 5) * 5), hi = Math.min(100, Math.ceil((Math.max(...values) + 5) / 5) * 5);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (values.length - 1);
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(values.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  return (
    <figure className="u-spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`% agree from ${fmtShort(days[0])} to ${fmtShort(days[days.length - 1])}: ${Math.round(values[0])}% to ${Math.round(values[values.length - 1])}%`}>
        <path d={area} className="u-area" />
        <path d={line} className="u-line" vectorEffect="non-scaling-stroke" />
        <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="3.5" className="u-dot" />
      </svg>
      <figcaption><span>{fmtShort(days[0])}</span><span>{lo}–{hi}%</span><span>{fmtShort(days[days.length - 1])}</span></figcaption>
    </figure>
  );
}

function Change({ v }: { v: number | null }) {
  if (v == null) return <span className="u-chg u-flat">Change vs 4 weeks ago shows from week 5</span>;
  const r = Math.round(v);
  if (Math.abs(v) < 1) return <span className="u-chg u-flat">No change vs 4 weeks ago</span>;
  return <span className={`u-chg ${r > 0 ? "u-up" : "u-down"}`}>{r > 0 ? "▲" : "▼"} {Math.abs(r)} {Math.abs(r) === 1 ? "pt" : "pts"} vs 4 weeks ago</span>;
}

export default async function UkPulse() {
  const { data, demo, error } = await load();
  const L = data.latest;
  const early = L ? data.days.length < 7 || (new Date(L.date).getTime() - new Date(L.earliest).getTime()) / 864e5 < 6 : true;

  return (
    <div className="chart">
      {demo && <div className="c-banner">Demo data: no database connected. Figures are synthetic.</div>}
      <div className="c-wrap">
        <div className="c-strip">
          <span>UK Pulse · {L ? `Updated ${fmtDate(L.date)}` : "Starting soon"}</span>
          <span><a href="/" className="u-nav">What to watch →</a></span>
        </div>
        <header className="c-mast">
          <h1>How the UK<br /><span className="c-accent">feels</span></h1>
          <p className="c-lede">Ten statements, asked the same way every day. Share of UK adults who agree, as a 7-day average.</p>
        </header>

        {!L ? (
          <section className="u-empty">
            <h2 className="c-h2">{error ? "The tracker is temporarily unavailable" : "Tracking starts with the next daily survey"}</h2>
            <p className="c-body">{error ? "Please try again shortly." : "The first readings appear once 30 people have answered. Trend lines build up from there and settle after the first week."}</p>
          </section>
        ) : (
          <>
            {early && <p className="u-early">Early readings: tracking began {fmtDate(L.earliest)}. Lines settle once there's a full week of data.</p>}
            <section className="u-grid" aria-label="Statements">
              {UK_KEYS.map((k: UkKey) => {
                const v = L.values[k];
                return (
                  <article key={k} className="u-card">
                    <h3>{UK_STATEMENTS[k]}</h3>
                    <div className="u-figs">
                      <span className="u-big">{Math.round(v.agree)}<small>% agree</small></span>
                      <span className="u-sub">{Math.round(v.disagree)}% disagree<br />net {v.net >= 0 ? "+" : "−"}{Math.abs(Math.round(v.net))}</span>
                    </div>
                    <Change v={L.change[k]} />
                    <Spark values={data.series[k]} days={data.days} />
                  </article>
                );
              })}
            </section>

            {data.groups && (
              <section className="c-section">
                <div className="c-head">
                  <h2 className="c-h1">Who agrees</h2>
                  <p className="c-muted c-narrow">% agree over the last 28 days. Blank where fewer than 40 people answered.</p>
                </div>
                <div className="c-table-wrap">
                  <table className="c-table u-table">
                    <thead><tr><th scope="col">Statement</th>{data.groups.labels.map((g, i) => <th key={g} scope="col" className="r">{g}<div className="c-muted c-small">n={data.groups!.n[i]}</div></th>)}</tr></thead>
                    <tbody>
                      {UK_KEYS.map((k) => (
                        <tr key={k}>
                          <td className="u-stmt">{UK_STATEMENTS[k]}</td>
                          {data.groups!.values[k].map((v, i) => <td key={i} className={`r ${i === 0 ? "u-all" : ""}`}>{v == null ? "–" : v}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}

        <footer className="c-foot">
          <span>
            Surveyed daily via Prolific among UK adults. Each reading pools the last 7 days ({L ? `latest n=${L.n.toLocaleString("en-GB")}, effective n≈${L.effectiveN}` : "about 770 people"}),
            weighted to the UK adult population by age, gender, region and social grade, and to 2024 general election results among people who voted.
            Margin of error about ±{L ? Math.max(2, Math.round(98 / Math.sqrt(Math.max(L.effectiveN, 1)))) : 4} points. Respondents who miss an attention check or rush the statements are excluded.
          </span>
        </footer>
      </div>
    </div>
  );
}
