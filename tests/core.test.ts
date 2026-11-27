import { describe, it, expect } from "vitest";
import { parseCountryTsv, surveyTitleSet, slugify } from "@/lib/netflix";
import { rake, UK_ADULT_TARGETS } from "@/lib/weighting";
import { composite, buildSnapshot, RespondentRecord, qualityExclusions } from "@/lib/scoring";
import { allocateDeepDives } from "@/lib/allocation";
import { qualityFlags, DECOY_ID, SubmissionSchema } from "@/lib/submission";
import { parseQueryRules, rank } from "@/lib/search";
import { matchScores, similarity } from "@/lib/match";
import { studyPayload, rewardPence } from "@/lib/prolific";
import { ATTRIBUTE_KEYS } from "@/lib/questionnaire";
import demo from "../public/demo-snapshot.json";
import { computePulse, demoPulseRows } from "@/lib/ukpulse";
import { ScreenedSchema, ukValid } from "@/lib/submission";
import type { Snapshot } from "@/lib/scoring";

const TSV = [
  "country_name\tcountry_iso2\tweek\tcategory\tweekly_rank\tshow_title\tseason_title\tcumulative_weeks_in_top_10",
  "United Kingdom\tGB\t2026-11-15\tTV\t1\tWednesday\tWednesday: Season 2\t3",
  "United Kingdom\tGB\t2026-11-15\tTV\t2\tSlow Burn\tN/A\t1",
  "United Kingdom\tGB\t2026-11-15\tFilms\t1\tThe Heist\tN/A\t2",
  "United Kingdom\tGB\t2026-11-08\tTV\t1\tWednesday\tWednesday: Season 2\t2",
  "United Kingdom\tGB\t2026-11-08\tTV\t2\tOld Show\tOld Show: Season 1\t5",
  "France\tFR\t2026-11-15\tTV\t1\tLupin\tLupin: Part 4\t1",
].join("\n");

describe("Netflix feed", () => {
  it("keeps UK rows only and maps categories", () => {
    const rows = parseCountryTsv(TSV);
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.showTitle === "The Heist")?.kind).toBe("film");
    expect(rows.find((r) => r.showTitle === "Slow Burn")?.seasonTitle).toBeNull();
  });
  it("builds the title set with carry-over from the previous week", () => {
    const set = surveyTitleSet(parseCountryTsv(TSV), { includeFilms: true });
    expect(set.week).toBe("2026-11-15");
    expect(set.current.map((t) => t.name)).toEqual(["Wednesday: Season 2", "Slow Burn", "The Heist"]);
    expect(set.carryOver.map((t) => t.name)).toEqual(["Old Show: Season 1"]);
  });
  it("back-fills from older weeks up to the target, always keeping last week's drop-outs", () => {
    const older = TSV + "\nUnited Kingdom\tGB\t2026-11-01\tTV\t1\tAncient\tAncient: Season 1\t4\nUnited Kingdom\tGB\t2026-11-01\tTV\t2\tAncient Two\tN/A\t4";
    expect(surveyTitleSet(parseCountryTsv(older), { target: 4 }).carryOver.map((t) => t.name)).toEqual(["Old Show: Season 1", "Ancient: Season 1"]);
    expect(surveyTitleSet(parseCountryTsv(older), { target: 2 }).carryOver.map((t) => t.name)).toEqual(["Old Show: Season 1"]);
  });
  it("excludes films by default", () => {
    const set = surveyTitleSet(parseCountryTsv(TSV));
    expect(set.current.map((t) => t.kind)).toEqual(["tv", "tv"]);
  });
  it("fails loudly if the feed format changes", () => {
    expect(() => parseCountryTsv("a\tb\nx\ty")).toThrow(/missing column/);
  });
  it("slugifies titles", () => expect(slugify("Love Is Blind: UK — Season 2")).toBe("love-is-blind-uk-season-2"));
});

describe("Weighting", () => {
  it("rakes a skewed sample to the targets", () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      id: String(i),
      cells: { gender: i < 700 ? "Woman" : "Man", ageBand: i % 2 ? "18-24" : "65+" },
    }));
    const r = rake(rows, { gender: UK_ADULT_TARGETS.gender, ageBand: { "18-24": 0.3, "65+": 0.7 } });
    const w = r.weights;
    const share = (pred: (i: number) => boolean) => {
      let a = 0, t = 0; for (let i = 0; i < 1000; i++) { t += w.get(String(i))!; if (pred(i)) a += w.get(String(i))!; } return a / t;
    };
    expect(r.converged).toBe(true);
    expect(share((i) => i < 700)).toBeCloseTo(0.51, 2);
    expect(share((i) => i % 2 === 0)).toBeCloseTo(0.7, 2);
    expect(r.efficiency).toBeLessThan(1);
  });
  it("caps extreme weights", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: String(i), cells: { gender: i < 2 ? "Man" : "Woman" } }));
    const r = rake(rows, { gender: { Man: 0.5, Woman: 0.5 } }, { cap: 5 });
    expect(Math.max(...r.weights.values())).toBeLessThanOrEqual(5.0001 * 1);
  });
});

function resp(id: string, ratings: { t: string; r: number; rec: number }[], extra: Partial<RespondentRecord> = {}): RespondentRecord {
  return {
    id, completedAt: "2026-11-16T10:00:00Z", durationSec: 480, age: 30, region: "London", gender: "Woman", grade: "C1",
    household: ["Partner"], genres: ["Drama"], attentionOk: true, decoyClaimed: false, straightliner: false,
    viewing: Object.fromEntries(ratings.map((x) => [x.t, { status: "finished" as const }])),
    ratings: ratings.map((x) => ({ titleId: x.t, rating: x.r, recommend: x.rec, attributes: Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, 3])), occasions: [], kidSafe: "yes" as const })),
    ...extra,
  };
}

describe("Scoring", () => {
  it("composite averages to the Viewer Score definition", () => {
    expect(composite(10, 10)).toBe(100);
    expect(composite(1, 0)).toBe(0);
    expect(composite(1, 8)).toBe(25);
  });
  it("labels titles by sample size and hides scores under 50 raters", () => {
    const current = [
      ...Array.from({ length: 120 }, (_, i) => resp(`a${i}`, [{ t: "x", r: 8, rec: 9 }])),
      ...Array.from({ length: 60 }, (_, i) => resp(`b${i}`, [{ t: "y", r: 6, rec: 6 }])),
      ...Array.from({ length: 10 }, (_, i) => resp(`c${i}`, [{ t: "z", r: 9, rec: 10 }])),
    ];
    const s = buildSnapshot({ snapshotDate: "2026-11-17", chartWeek: null, window: { from: "2026-11-11", to: "2026-11-17" },
      titles: ["x", "y", "z"].map((id) => ({ id, name: id, kind: "tv" as const, chartRank: 1 })), current, previous: [] });
    const by = Object.fromEntries(s.titles.map((t) => [t.id, t]));
    expect(by.x.status).toBe("scored");
    expect(by.x.viewerScore).toBeCloseTo(composite(8, 9), 1);
    expect(by.x.netRecommend).toBe(100);
    expect(by.y.status).toBe("early");
    expect(by.z.status).toBe("too_new");
    expect(by.z.viewerScore).toBeNull();
  });
  it("excludes decoy claimers, failed attention checks and speeders", () => {
    const rs = [
      ...Array.from({ length: 20 }, (_, i) => resp(`ok${i}`, [])),
      resp("decoy", [], { decoyClaimed: true }),
      resp("attn", [], { attentionOk: false }),
      resp("fast", [], { durationSec: 60 }),
    ];
    expect([...qualityExclusions(rs)].sort()).toEqual(["attn", "decoy", "fast"]);
  });
});

describe("Allocation", () => {
  it("picks watched titles furthest from target, max 4", () => {
    const got = allocateDeepDives(
      { a: "finished", b: "watching", c: "stopped", d: "finished", e: "finished", f: "heard" },
      { a: 99, b: 10, c: 50, d: 0, e: 120 }, { random: () => 0.5 });
    expect(got).toEqual(["d", "b", "c", "a"]);
  });
});

describe("Submission", () => {
  it("flags decoy, attention and straight-lining", () => {
    const base = {
      waveId: 1, startedAt: new Date().toISOString(),
      screener: { age: 30, region: "London", services: ["Netflix"], hours: "2–5" },
      viewing: { [DECOY_ID]: "watching", t1: "finished" },
      ratings: [{ titleId: "t1", rating: 5, recommend: 5, attributes: Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, 3])) }],
      profile: { gender: "Man", household: ["Alone"], grade: "C1", genres: ["Drama"], attitudes: { british: 3 }, attention: "Never" },
    };
    const s = SubmissionSchema.parse(base);
    expect(qualityFlags(s)).toEqual({ decoyClaimed: true, attentionOk: false, straightliner: true });
  });
});

describe("Search + people like me", () => {
  const snap = demo as unknown as Snapshot;
  it("parses natural language into filters", () => {
    const f = parseQueryRules("something funny to watch with my kids, nothing too scary");
    expect(f.attributes).toContain("funny");
    expect(f.familySafe).toBe(true);
    expect(f.avoid).toContain("tense");
    expect(parseQueryRules("a gripping film for date night").kind).toBe("film");
  });
  it("only ranks titles from the dataset and respects family filter", () => {
    const res = rank(snap, parseQueryRules("something for the kids"));
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((r) => (r.title.kidSafe ?? 0) >= 0.5)).toBe(true);
    const ids = new Set(snap.titles.map((t) => t.id));
    expect(res.every((r) => ids.has(r.title.id))).toBe(true);
  });
  it("matched scores move toward similar raters", () => {
    expect(similarity([0, 50, 1, 0, 1, 0, 0], { ageBand: "18-24", gender: "Woman" })).toBe(1);
    const young = matchScores(snap, { ageBand: "18-24" });
    const old = matchScores(snap, { ageBand: "65+" });
    const loveOnLoop = snap.titles.find((t) => t.name.startsWith("Love on Loop"))!;
    expect(young.get(loveOnLoop.id)!.matchScore).toBeGreaterThan(old.get(loveOnLoop.id)!.matchScore);
  });
});

describe("Prolific", () => {
  it("builds a study payload with URL placeholders and auto-approve", () => {
    const p = studyPayload({ name: "n", internalName: "i", description: "d", externalUrl: "https://x.app/survey?wave=3",
      places: 175, minutes: 8, rewardPence: rewardPence(8, 9), completionCode: "ABCD1234" });
    expect(p.external_study_url).toBe("https://x.app/survey?wave=3&PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}");
    expect(p.reward).toBe(120);
    expect(p.completion_codes[0].actions[0].action).toBe("AUTOMATICALLY_APPROVE");
    expect(p.prolific_id_option).toBe("url_parameters");
  });
});

describe("Prolific UK filter lookup", () => {
  it("finds the UK choice in object or array choice formats", async () => {
    const { findUkResidenceFilter } = await import("@/lib/prolific");
    expect(findUkResidenceFilter([
      { filter_id: "handedness", title: "Handedness", choices: { "0": "Left" } },
      { filter_id: "current-country-of-residence", title: "Current Country of Residence", type: "select", choices: { "0": "United States", "1": "United Kingdom" } },
    ])).toEqual({ filter_id: "current-country-of-residence", selected_values: ["1"] });
    expect(findUkResidenceFilter([
      { id: "country-of-residence", question: "What country do you currently reside in?", choices: [{ value: "x7", label: "United Kingdom" }] },
    ])).toEqual({ filter_id: "country-of-residence", selected_values: ["x7"] });
    expect(findUkResidenceFilter([{ filter_id: "nationality", title: "Nationality", choices: { "1": "United Kingdom" } }])).toBeNull();
  });
});

describe("UK Pulse", () => {
  it("produces rolling readings, a 4-week change and subgroup breakdowns", () => {
    const p = computePulse(demoPulseRows(40));
    expect(p.days.length).toBeGreaterThan(30);
    expect(p.latest!.n).toBe(7 * 110);
    for (const v of Object.values(p.latest!.values)) { expect(v.agree).toBeGreaterThan(0); expect(v.agree + v.disagree).toBeLessThanOrEqual(100.0001); }
    expect(p.latest!.change.direction).not.toBeNull();
    expect(p.groups!.labels[0]).toBe("All adults");
  });
  it("returns an empty tracker with no data", () => expect(computePulse([]).latest).toBeNull());
  it("validates screen-out answers and the attention item", () => {
    const uk = { statements: { direction: 2, finances: 3, costOfLiving: 5, nhs: 2, news: 2, ai: 3, children: 4, proud: 4, localArea: 3, safe: 4 }, check: 2, pastVote: "Didn't vote", seconds: 40 };
    expect(ScreenedSchema.safeParse({ screenedOut: true, waveId: 1, startedAt: "x", about: { age: 30, region: "London", gender: "Woman", grade: "C1" }, uk }).success).toBe(true);
    expect(ukValid({ check: 2, seconds: 40 })).toBe(true);
    expect(ukValid({ check: 3, seconds: 40 })).toBe(false);
    expect(ukValid({ check: 2, seconds: 5 })).toBe(false);
  });
});
