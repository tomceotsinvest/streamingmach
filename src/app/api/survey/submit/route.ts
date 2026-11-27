import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { completionUrl } from "@/lib/prolific";
import { SubmissionSchema, ScreenedSchema, qualityFlags, DECOY_ID, isEligible } from "@/lib/submission";
import { ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const db = sql();
  await ensureSchema();

  // Screen-outs are recorded (for incidence tracking) but carry no answers
  if (body?.screenedOut) {
    // Paid via the normal completion code: Prolific doesn't allow unpaid in-study screen-outs
    const [w] = await db`select completion_code from survey_waves where id = ${Number(body.waveId) || 0}`;
    const sc = ScreenedSchema.safeParse(body);
    if (sc.success) {
      const a = sc.data.about, u = sc.data.uk;
      await db`insert into respondents (wave_id, prolific_pid, session_id, status, started_at, duration_sec, age, region, gender, social_grade,
                 uk, uk_check, uk_seconds, past_vote)
               values (${sc.data.waveId}, ${sc.data.prolificPid ?? null}, ${sc.data.sessionId ?? null}, 'screened', ${sc.data.startedAt},
                 ${Math.max(0, Math.round((Date.now() - Date.parse(sc.data.startedAt)) / 1000))}, ${a.age}, ${a.region}, ${a.gender}, ${a.grade},
                 ${db.json(u.statements)}, ${u.check}, ${u.seconds}, ${u.pastVote})`;
    } else {
      await db`insert into respondents (wave_id, prolific_pid, session_id, status, started_at)
               values (${Number(body.waveId) || null}, ${body.prolificPid ?? null}, ${body.sessionId ?? null}, 'screened', ${body.startedAt ?? null})`;
    }
    return NextResponse.json({ screened: true, redirect: w ? completionUrl(w.completion_code) : null });
  }

  const parsed = SubmissionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  const s = parsed.data;
  if (!isEligible(s.screener)) return NextResponse.json({ error: "not eligible" }, { status: 400 });

  const [wave] = await db`select id, title_ids, completion_code from survey_waves where id = ${s.waveId}`;
  if (!wave) return NextResponse.json({ error: "unknown wave" }, { status: 404 });
  const valid = new Set<string>(wave.title_ids);
  const flags = qualityFlags(s);
  const duration = Math.max(0, Math.round((Date.now() - Date.parse(s.startedAt)) / 1000));

  await db.begin(async (tx) => {
    const [r] = await tx`
      insert into respondents (wave_id, prolific_pid, session_id, status, started_at, duration_sec, age, region, services, hours,
        gender, household, social_grade, genres, attitudes, best_title, attention_ok, decoy_claimed, straightliner,
        uk, uk_check, uk_seconds, past_vote)
      values (${s.waveId}, ${s.prolificPid ?? null}, ${s.sessionId ?? null}, 'complete', ${s.startedAt}, ${duration},
        ${s.screener.age}, ${s.screener.region}, ${s.screener.services}, ${s.screener.hours},
        ${s.profile.gender}, ${s.profile.household}, ${s.profile.grade}, ${s.profile.genres},
        ${tx.json(s.profile.attitudes)}, ${s.profile.bestTitle ?? null},
        ${flags.attentionOk}, ${flags.decoyClaimed}, ${flags.straightliner},
        ${s.uk ? tx.json(s.uk.statements) : null}, ${s.uk?.check ?? null}, ${s.uk?.seconds ?? null}, ${s.uk?.pastVote ?? null})
      returning id`;
    for (const [titleId, status] of Object.entries(s.viewing)) {
      if (titleId === DECOY_ID || !valid.has(titleId)) continue;
      await tx`insert into viewing (respondent_id, title_id, status, stop_reason, plan_to_watch, heard_via)
               values (${r.id}, ${titleId}, ${status}, ${s.stopReasons[titleId] ?? null},
                       ${s.plans.includes(titleId)}, ${s.heardVia[titleId] ?? null})`;
    }
    for (const g of s.ratings) {
      if (!valid.has(g.titleId)) continue;
      await tx`insert into ratings (respondent_id, title_id, rating, recommend, watched_with, loyalty, attributes, occasions, kid_safe)
               values (${r.id}, ${g.titleId}, ${g.rating}, ${g.recommend}, ${g.watchedWith}, ${g.loyalty},
                       ${tx.json(g.attributes)}, ${g.occasions}, ${g.kidSafe})`;
    }
  });

  // Everyone who completes is paid; flagged responses are excluded from scoring, not rejected
  return NextResponse.json({ redirect: completionUrl(wave.completion_code) });
}
