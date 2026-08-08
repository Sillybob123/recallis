// Anki-style scheduler: minute-based learning/relearning steps as a plain
// state machine, with FSRS-6 governing cards once they graduate to review.
// Quizlet/cram mode never touches this state — only grading in Anki mode.

export type Rating = "again" | "hard" | "good" | "easy";
export type FlagColor = "red" | "orange" | "green" | "blue";

export interface SrsState {
  phase: "learn" | "review" | "relearn";
  /** index into learning/relearning steps while in learn/relearn */
  step: number;
  /** legacy SM-2 ease — kept for old data, unused by FSRS */
  ease: number;
  /** current interval in days (review phase) */
  ivl: number;
  /** epoch ms when the card is next due */
  due: number;
  reps: number;
  lapses: number;
  /** FSRS memory state */
  stab?: number;
  diff?: number;
  lastReviewAt?: number;
  /** epoch ms of the first-ever grade — used for the new-cards/day limit */
  firstSeen?: number;
  /** epoch ms of the latest grade — used for the reviews/day limit */
  lastReviewed?: number;
  /** card metadata (Anki-style) */
  flag?: FlagColor | null;
  suspended?: boolean;
  buriedUntil?: number | null;
  marked?: boolean;
}

export interface SrsConfig {
  learnStepsMin: number[];
  relearnStepsMin: number[];
  maxIntervalDays: number;
  /** FSRS desired retention, 0-1 (user's Anki preset: 0.9) */
  desiredRetention: number;
}

/** Matches the user's Anki preset: 10m learning step, 10m relearning step, 90%. */
export const DEFAULT_SRS_CONFIG: SrsConfig = {
  learnStepsMin: [10],
  relearnStepsMin: [10],
  maxIntervalDays: 36500,
  desiredRetention: 0.9,
};

// FSRS-6 default parameters (21 weights).
const W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722,
  0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425,
  0.0912, 0.0658, 0.1542,
];

const MIN = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

const FACTOR = Math.pow(0.9, -1 / W[20]) - 1;

function retrievability(tDays: number, S: number): number {
  return Math.pow(1 + (FACTOR * Math.max(tDays, 0)) / S, -W[20]);
}

function nextIntervalDays(retention: number, S: number): number {
  return (S / FACTOR) * (Math.pow(retention, 1 / -W[20]) - 1);
}

function ratingNum(r: Rating): number {
  return { again: 1, hard: 2, good: 3, easy: 4 }[r];
}

function initialStability(g: number): number {
  return W[g - 1];
}

function initialDifficulty(g: number): number {
  return clampD(W[4] - Math.exp(W[5] * (g - 1)) + 1);
}

function clampD(d: number): number {
  return Math.min(Math.max(d, 1), 10);
}

function nextDifficulty(D: number, g: number): number {
  const delta = -W[6] * (g - 3);
  const dPrime = D + (delta * (10 - D)) / 9;
  return clampD(W[7] * initialDifficulty(4) + (1 - W[7]) * dPrime);
}

function nextStabilitySuccess(D: number, S: number, R: number, g: number): number {
  const hardPenalty = g === 2 ? W[15] : 1;
  const easyBonus = g === 4 ? W[16] : 1;
  const gain =
    Math.exp(W[8]) *
    (11 - D) *
    Math.pow(S, -W[9]) *
    (Math.exp(W[10] * (1 - R)) - 1) *
    hardPenalty *
    easyBonus;
  return S * (1 + gain);
}

function nextStabilityFail(D: number, S: number, R: number): number {
  return (
    W[11] *
    Math.pow(D, -W[12]) *
    (Math.pow(S + 1, W[13]) - 1) *
    Math.exp(W[14] * (1 - R))
  );
}

function sameDayStability(S: number, g: number): number {
  return S * Math.exp(W[17] * (g - 3 + W[18])) * Math.pow(S, -W[19]);
}

export function newSrsState(now = Date.now()): SrsState {
  return { phase: "learn", step: 0, ease: 2.5, ivl: 0, due: now, reps: 0, lapses: 0 };
}

function fuzz(days: number): number {
  if (days < 2) return days;
  const spread = Math.max(1, Math.round(days * 0.05));
  return days + Math.floor(Math.random() * (spread * 2 + 1)) - spread;
}

function scheduleReview(s: SrsState, now: number, cfg: SrsConfig) {
  const raw = nextIntervalDays(cfg.desiredRetention, s.stab ?? 1);
  s.ivl = Math.min(cfg.maxIntervalDays, Math.max(1, Math.round(raw)));
  s.due = now + fuzz(s.ivl) * DAY;
}

/** Applies a rating, returning the next state. Pure — caller persists. */
export function rate(
  prev: SrsState | null,
  rating: Rating,
  now = Date.now(),
  cfg: SrsConfig = DEFAULT_SRS_CONFIG
): SrsState {
  const s: SrsState = prev ? { ...prev } : newSrsState(now);
  const g = ratingNum(rating);
  s.reps += 1;
  s.firstSeen = prev?.firstSeen ?? now;
  s.lastReviewed = now;
  s.buriedUntil = null; // answering un-buries

  if (s.phase === "learn" || s.phase === "relearn") {
    const steps = s.phase === "learn" ? cfg.learnStepsMin : cfg.relearnStepsMin;
    if (rating === "again") {
      s.step = 0;
      s.due = now + steps[0] * MIN;
    } else if (rating === "hard") {
      const cur = steps[Math.min(s.step, steps.length - 1)];
      const next = steps[Math.min(s.step + 1, steps.length - 1)];
      s.due = now + Math.round((cur + next) / 2 || cur * 1.5) * MIN;
    } else if (rating === "good" && s.step + 1 < steps.length) {
      s.step += 1;
      s.due = now + steps[s.step] * MIN;
    } else {
      // Graduate (good on last step, or easy from anywhere).
      const wasRelearn = s.phase === "relearn";
      s.phase = "review";
      s.step = 0;
      if (!wasRelearn || s.stab === undefined) {
        // First graduation: FSRS initial memory state from the graduating grade.
        s.stab = initialStability(g);
        s.diff = initialDifficulty(g);
      }
      s.lastReviewAt = now;
      scheduleReview(s, now, cfg);
      return s;
    }
    return s;
  }

  // Review phase — FSRS-6.
  const elapsedDays = (now - (s.lastReviewAt ?? now)) / DAY;
  const S = s.stab ?? initialStability(g);
  const D = s.diff ?? initialDifficulty(g);
  const R = retrievability(elapsedDays, S);

  s.diff = nextDifficulty(D, g);
  if (elapsedDays < 1) {
    s.stab = sameDayStability(S, g);
  } else if (rating === "again") {
    s.stab = nextStabilityFail(s.diff, S, R);
  } else {
    s.stab = nextStabilitySuccess(s.diff, S, R, g);
  }
  s.lastReviewAt = now;

  if (rating === "again") {
    s.lapses += 1;
    s.phase = "relearn";
    s.step = 0;
    s.due = now + cfg.relearnStepsMin[0] * MIN;
  } else {
    scheduleReview(s, now, cfg);
  }
  return s;
}

/** Human label for the interval each rating would produce ("<10m", "3d", "1.2mo"). */
export function previewIntervals(
  prev: SrsState | null,
  now = Date.now(),
  cfg: SrsConfig = DEFAULT_SRS_CONFIG
): Record<Rating, string> {
  const out = {} as Record<Rating, string>;
  for (const rating of ["again", "hard", "good", "easy"] as Rating[]) {
    const next = rate(prev ? { ...prev } : null, rating, now, cfg);
    out[rating] = formatDelay(next.due - now);
  }
  return out;
}

export function formatDelay(ms: number): string {
  if (ms < 60 * MIN) return `<${Math.max(1, Math.round(ms / MIN))}m`;
  if (ms < DAY) return `${Math.round(ms / (60 * MIN))}h`;
  const days = ms / DAY;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${(days / 30).toFixed(1)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

export function isDue(state: SrsState | null | undefined, now = Date.now()): boolean {
  if (!state || state.reps === 0) return true; // never graded = new = available
  return state.due <= now;
}

/** New = never actually graded (a doc may exist just to hold a flag). */
export function isNew(state: SrsState | null | undefined): boolean {
  return !state || state.reps === 0;
}

/** Excluded from today's queue? (suspended, or buried until later) */
export function isExcluded(
  state: SrsState | null | undefined,
  now = Date.now()
): boolean {
  if (!state) return false;
  if (state.suspended) return true;
  if (state.buriedUntil && state.buriedUntil > now) return true;
  return false;
}

/** Next 4 AM — Anki's day rollover, used for burying. */
export function nextDayStart(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(4, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}
