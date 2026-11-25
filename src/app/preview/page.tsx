import Dashboard from "../Dashboard";
import ChartDashboard from "../ChartDashboard";
import { computeSnapshot, currentTitleSet, londonDate } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preview (unpublished)", robots: { index: false, follow: false } };

// Unpublished preview of live data with low thresholds, so early fieldwork can be eyeballed.
// Scores here rest on a handful of ratings each: not for sharing.
export default async function Preview({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  const theme = (await searchParams).theme ?? process.env.NEXT_PUBLIC_THEME ?? "chart";
  const { titleIds, week } = await currentTitleSet();
  if (!titleIds.length) return <main className="empty"><h1>No survey wave yet</h1></main>;
  const { snapshot } = await computeSnapshot(londonDate(), titleIds, week, { scored: 10, early: 3 });
  const s = snapshot.sample;
  snapshot.preview = `Unpublished preview · ${s.valid} valid responses (${s.excluded} excluded) · scores shown from 3 ratings, so expect big swings · not for sharing`;
  const brand = process.env.NEXT_PUBLIC_BRAND ?? "Streaming Machine";
  // "chart" (Concept C, Dusk) is the chosen design; ?theme=dark|paper|clean keeps the earlier versions viewable
  if (theme === "chart") return <ChartDashboard snap={snapshot} brand={brand} />;
  return <Dashboard snap={snapshot} brand={brand} theme={theme} />;
}
