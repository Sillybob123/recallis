// Study settings, persisted in localStorage. Anki-mode defaults mirror the
// user's actual Anki preset: learning steps 10m, relearning steps 10m,
// 60 new/day, 9999 reviews/day, max interval 36500 days.

import type { SiblingMode } from "./siblings";

export interface AnkiSettings {
  newPerDay: number;
  maxReviewsPerDay: number;
  newIgnoreReviewLimit: boolean;
  limitsStartFromTop: boolean;
  /** learning steps in minutes */
  learnStepsMin: number[];
  /** relearning steps in minutes */
  relearnStepsMin: number[];
  maxIntervalDays: number;
  /** FSRS desired retention percent, e.g. 90 */
  desiredRetentionPct: number;
  /**
   * What to do with the other cards from a note you just answered.
   * Applies to both study modes — it's about the session, not the schedule.
   */
  siblingMode: SiblingMode;
  /** cards to keep between siblings when dispersing */
  siblingGap: number;
}

export const DEFAULT_ANKI_SETTINGS: AnkiSettings = {
  newPerDay: 60,
  maxReviewsPerDay: 9999,
  newIgnoreReviewLimit: false,
  limitsStartFromTop: true,
  learnStepsMin: [10],
  relearnStepsMin: [10],
  maxIntervalDays: 36500,
  desiredRetentionPct: 90,
  siblingMode: "disperse",
  siblingGap: 10,
};

export type GradingLevel = "relaxed" | "moderate" | "strict";

export interface QuizletSettings {
  /** Learn-mode question formats */
  enableMultipleChoice: boolean;
  enableWritten: boolean;
  /** how typed answers are graded */
  grading: GradingLevel;
  /** after a miss, require retyping the correct answer to continue */
  retypeCorrect: boolean;
  /** answer with the definition (front→back) or the term (back→front) */
  answerWith: "definition" | "term";
}

export const DEFAULT_QUIZLET_SETTINGS: QuizletSettings = {
  enableMultipleChoice: true,
  enableWritten: true,
  grading: "moderate",
  retypeCorrect: true,
  answerWith: "definition",
};

function load<T>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...defaults };
    return { ...defaults, ...(JSON.parse(raw) as Partial<T>) };
  } catch {
    return { ...defaults };
  }
}

export function loadAnkiSettings(): AnkiSettings {
  return load("ankiSettings", DEFAULT_ANKI_SETTINGS);
}

export function saveAnkiSettings(s: AnkiSettings) {
  localStorage.setItem("ankiSettings", JSON.stringify(s));
}

export function loadQuizletSettings(): QuizletSettings {
  return load("quizletSettings", DEFAULT_QUIZLET_SETTINGS);
}

export function saveQuizletSettings(s: QuizletSettings) {
  localStorage.setItem("quizletSettings", JSON.stringify(s));
}

/** Parses "10m 1d 3d" style step lists into minutes. */
export function parseSteps(text: string): number[] {
  const out: number[] = [];
  for (const tok of text.trim().split(/\s+/)) {
    const m = tok.match(/^(\d+(?:\.\d+)?)(m|h|d)?$/i);
    if (!m) continue;
    const n = parseFloat(m[1]);
    const unit = (m[2] || "m").toLowerCase();
    out.push(unit === "d" ? n * 1440 : unit === "h" ? n * 60 : n);
  }
  return out.length ? out : [10];
}

export function formatSteps(stepsMin: number[]): string {
  return stepsMin
    .map((m) =>
      m % 1440 === 0 ? `${m / 1440}d` : m % 60 === 0 ? `${m / 60}h` : `${m}m`
    )
    .join(" ");
}

/** Local start-of-day (4 AM boundary like Anki's default next-day cutoff). */
export function startOfStudyDay(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(4, 0, 0, 0);
  if (d.getTime() > now) d.setDate(d.getDate() - 1);
  return d.getTime();
}

// ---------- Anki-mode daily study stats (device-local) ----------

interface DayStats {
  count: number;
  ms: number;
}

function statsKey(now = Date.now()): string {
  return `ankiStudy:${startOfStudyDay(now)}`;
}

export function recordAnkiReview(durationMs: number, now = Date.now()) {
  const key = statsKey(now);
  let cur: DayStats = { count: 0, ms: 0 };
  try {
    cur = { ...cur, ...(JSON.parse(localStorage.getItem(key) ?? "{}") as DayStats) };
  } catch {
    /* fresh */
  }
  cur.count += 1;
  cur.ms += Math.min(Math.max(durationMs, 0), 60000);
  localStorage.setItem(key, JSON.stringify(cur));
  // Drop stale day entries so localStorage doesn't accumulate.
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith("ankiStudy:") && k !== key) localStorage.removeItem(k);
  }
}

export function getTodayAnkiStats(now = Date.now()): DayStats {
  const base: DayStats = { count: 0, ms: 0 };
  try {
    const parsed = JSON.parse(
      localStorage.getItem(statsKey(now)) ?? "{}"
    ) as Partial<DayStats>;
    return { count: parsed.count ?? 0, ms: parsed.ms ?? 0 };
  } catch {
    return base;
  }
}
