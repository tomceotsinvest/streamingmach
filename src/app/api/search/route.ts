import { NextResponse } from "next/server";
import { parseQueryLLM, parseQueryRules } from "@/lib/search";

export const dynamic = "force-dynamic";

// Turns a natural-language request into filters. Ranking happens in the browser against the published dataset.
export async function POST(req: Request) {
  const { q } = (await req.json().catch(() => ({}))) as { q?: string };
  if (!q || typeof q !== "string") return NextResponse.json({ error: "missing q" }, { status: 400 });
  const llm = await parseQueryLLM(q);
  return NextResponse.json({ filters: llm ?? parseQueryRules(q), engine: llm ? "claude" : "rules" });
}
