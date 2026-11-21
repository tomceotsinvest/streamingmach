import Dashboard from "../Dashboard";
import { computeSnapshot, currentTitleSet, londonDate } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preview (unpublished)", robots: { index: false, follow: false } };

// Unpublished preview of live data with low thresholds, so early fieldwork can be eyeballed.
// Scores here rest on a handful of ratings each: not for sharing.
export default async function Preview() {
  const { titleIds, week } = await currentTitleSet();
  if (!titleIds.length) return <main className="empty"><h1>No survey wave yet</h1></main>;
  const { snapshot } = await computeSnapshot(londonDate(), titleIds, week, { scored: 10, early: 3 });
  const s = snapshot.sample;
  snapshot.preview = `Unpublished preview · ${s.valid} valid responses (${s.excluded} excluded) · scores shown from 3 ratings, so expect big swings · not for sharing`;
  return <Dashboard snap={snapshot} brand={process.env.NEXT_PUBLIC_BRAND ?? "Streaming Machine"} />;
}
