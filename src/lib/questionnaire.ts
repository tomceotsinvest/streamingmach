// Survey v1 — the fixed template. Every day's wave drops that day's titles into this structure,
// so question wording and answer codes never change between waves (that is what makes trends valid).

export const SURVEY_VERSION = "v1";

export const REGIONS = [
  "North East", "North West", "Yorkshire and the Humber", "East Midlands", "West Midlands",
  "East of England", "London", "South East", "South West", "Wales", "Scotland", "Northern Ireland",
] as const;

export const SERVICES = [
  "Netflix", "Prime Video", "Apple TV", "Disney+", "NOW", "BBC iPlayer", "ITVX", "Channel 4", "Paramount+", "None of these",
] as const;

export const HOURS = ["0", "Under 2", "2–5", "6–10", "11–20", "Over 20"] as const;

// A1 — viewing status for each title
export const VIEW_STATUS = {
  finished: "Finished / caught up",
  watching: "Watching now",
  stopped: "Started and stopped",
  heard: "Heard of it, not watched",
  never: "Never heard of it",
} as const;
export type ViewStatus = keyof typeof VIEW_STATUS;
export const WATCHED: ViewStatus[] = ["finished", "watching", "stopped"];

export const STOP_REASONS = ["Too slow", "Not my thing", "Too dark or violent", "Lost track", "Too long", "Other"] as const;
export const HEARD_VIA = [
  "Friend or family", "Social media", "Netflix recommended it", "TV ad or press", "Review site", "Don't remember",
] as const;

export const WATCHED_WITH = ["Alone", "Partner", "Children under 16", "Other adults at home", "Friends"] as const;
export const LOYALTY = ["Definitely", "Probably", "Probably not", "Definitely not"] as const;

// C1 — content-type attributes (1–5). Keys are stable codes; labels can be reworded without breaking history.
export const ATTRIBUTES = {
  gripping: "Gripping",
  funny: "Funny",
  moving: "Moving",
  tense: "Tense or scary",
  thoughtful: "Thought-provoking",
  easy: "Easy to watch",
  stunning: "Visually stunning",
  acting: "Great acting",
  ending: "Satisfying ending",
  bingeable: "Bingeable",
} as const;
export type AttributeKey = keyof typeof ATTRIBUTES;
export const ATTRIBUTE_KEYS = Object.keys(ATTRIBUTES) as AttributeKey[];

// C2 — best occasion (pick up to 3)
export const OCCASIONS = {
  unwind: "To unwind",
  family: "Family night",
  date: "Date night",
  binge: "Solo binge",
  laugh: "Need a laugh",
  edge: "Edge-of-seat night",
  background: "On in the background",
} as const;
export type OccasionKey = keyof typeof OCCASIONS;
export const OCCASION_KEYS = Object.keys(OCCASIONS) as OccasionKey[];

export const KID_SAFE = { yes: "Yes", older: "Only older kids", no: "No" } as const;

export const GENDERS = ["Man", "Woman", "Describe another way", "Prefer not to say"] as const;
export const HOUSEHOLD = ["Alone", "Partner", "Children under 16", "Children 16+", "Housemates", "Parents"] as const;

// D3 — maps to social grade (ABC1 / C2DE) for weighting; simplified census-style occupation question
export const OCCUPATION = {
  AB: "Senior or professional (manager, director, doctor, lawyer, senior civil servant)",
  C1: "Supervisory, clerical or junior management (office, admin, teacher, nurse)",
  C2: "Skilled manual (electrician, plumber, mechanic)",
  DE: "Semi or unskilled manual, casual work, or not working / state pension only",
} as const;
export type OccupationCode = keyof typeof OCCUPATION;

export const GENRES = [
  "Crime", "Drama", "Comedy", "Sci-fi / fantasy", "Thriller", "Documentary", "Reality",
  "Romance", "Action", "Horror", "Animation", "True crime",
] as const;

export const ATTITUDES = {
  british: "I prefer British shows",
  subtitles: "I'm happy to watch with subtitles",
  short: "I prefer short series",
  noViolence: "I avoid graphic violence",
  recs: "I mostly watch what others recommend",
  finisher: "I finish what I start",
} as const;
export type AttitudeKey = keyof typeof ATTITUDES;
export const ATTITUDE_KEYS = Object.keys(ATTITUDES) as AttitudeKey[];

// Coarser groups used to match visitors to raters in "For people like you"
export const AREA_GROUPS = ["London", "South & East", "Midlands", "North", "Scotland, Wales & NI"] as const;
export function areaGroup(region: string | null | undefined): number {
  switch (region) {
    case "London": return 0;
    case "South East": case "South West": case "East of England": return 1;
    case "East Midlands": case "West Midlands": return 2;
    case "North East": case "North West": case "Yorkshire and the Humber": return 3;
    case "Scotland": case "Wales": case "Northern Ireland": return 4;
    default: return -1;
  }
}
export const LIVES_WITH = ["On my own", "With a partner", "With housemates or family"] as const;
export function livesWith(household: string[]): number {
  if (household.includes("Partner")) return 1;
  if (household.some((h) => h === "Housemates" || h === "Parents" || h === "Children 16+")) return 2;
  if (household.includes("Alone")) return 0;
  return -1;
}
export const TV_DIET = ["Light (under 2 hrs a week)", "Regular (2–10 hrs)", "Heavy (over 10 hrs)"] as const;
export function tvDiet(hours: string | null | undefined): number {
  if (hours == null) return -1;
  if (hours === "0" || hours === "Under 2") return 0;
  if (hours === "2–5" || hours === "6–10") return 1;
  return 2;
}
export function attitudeMask(att: Record<string, number> | null | undefined): number {
  if (!att) return 0;
  return ATTITUDE_KEYS.reduce((m, k, i) => ((att[k] ?? 0) >= 4 ? m | (1 << i) : m), 0);
}

export const ATTENTION_CHECK = { prompt: 'To show you are reading, please select "Sometimes".', answer: "Sometimes",
  options: ["Never", "Rarely", "Sometimes", "Often", "Always"] } as const;

// Fictional titles used as a decoy in A1. Anyone claiming to have watched one is flagged as an overclaimer.
// Each name was web-checked for no real show with the same or a near-identical title.
export const DECOYS = ["The Pellworth Inquiry", "Brindle & Vane", "The Kestrel Accord", "Thistledown Bay"];
// Decoys withdrawn because they turned out to resemble real shows; claims on them are not treated as overclaiming.
// "Saltmarsh" is too close to Sky's Under Salt Marsh (Nov 2026).
export const RETIRED_DECOYS = ["Saltmarsh"];
export function decoyFor(dateISO: string): string {
  const d = Number(dateISO.replaceAll("-", ""));
  return DECOYS[d % DECOYS.length];
}

export const MAX_DEEP_DIVES = 4;
export const AGE_BANDS = ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
export function ageBand(age: number): AgeBand {
  if (age < 25) return "18-24";
  if (age < 35) return "25-34";
  if (age < 45) return "35-44";
  if (age < 55) return "45-54";
  if (age < 65) return "55-64";
  return "65+";
}
