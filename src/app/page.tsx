import { readFile } from "node:fs/promises";
import path from "node:path";
import Dashboard from "./Dashboard";
import ChartDashboard from "./ChartDashboard";
import { hasDb } from "@/lib/db";
import { latestPublishedSnapshot } from "@/lib/pipeline";
import type { Snapshot } from "@/lib/scoring";

export const revalidate = 600; // re-read the published snapshot at most every 10 minutes

async function loadSnapshot(): Promise<Snapshot | null> {
  if (hasDb()) {
    try { return await latestPublishedSnapshot(); } catch (e) { console.error(e); return null; }
  }
  // No database configured (local preview): use the clearly-labelled demo dataset, if present
  try {
    const raw = await readFile(path.join(process.cwd(), "public", "demo-snapshot.json"), "utf8");
    return JSON.parse(raw) as Snapshot;
  } catch { return null; }
}

export default async function Page({ searchParams }: { searchParams: Promise<{ theme?: string }> }) {
  const theme = (await searchParams).theme ?? process.env.NEXT_PUBLIC_THEME ?? "chart";
  const snap = await loadSnapshot();
  if (!snap) {
    return <main className="empty"><h1>No ratings published yet</h1><p>The first scores appear once enough viewers have taken the survey.</p></main>;
  }
  const brand = process.env.NEXT_PUBLIC_BRAND ?? "Streaming Machine";
  // "chart" (Concept C, Dusk) is the chosen design; ?theme=dark|paper|clean keeps the earlier versions viewable
  if (theme === "chart") return <ChartDashboard snap={snap} brand={brand} />;
  return <Dashboard snap={snap} brand={brand} theme={theme} />;
}
