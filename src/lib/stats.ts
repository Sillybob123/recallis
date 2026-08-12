// Turning a pile of review records into the few numbers worth looking at.
//
// Deliberately a small set. A stats page that reports fifteen things gets
// read once; the ones here answer questions people actually have — did I
// study today, how long is my streak, how much of this is sticking, and
// where did the time go.

import type { ReviewLogEntry } from "./firestore";

/** Local calendar day, which is the unit a streak is counted in. */
export function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function addDays(at: number, days: number): number {
  const d = new Date(at);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export interface DayStat {
  key: string;
  at: number;
  reviews: number;
  msSpent: number;
}

export interface StudyStats {
  /** oldest first, one entry per day in the window including empty ones */
  days: DayStat[];
  totalReviews: number;
  totalMs: number;
  activeDays: number;
  /** consecutive days up to and including today (or yesterday, if today is unstarted) */
  streak: number;
  longestStreak: number;
  busiestDay: DayStat | null;
  ratings: { again: number; hard: number; good: number; easy: number };
  /** share of answers that weren't "again", 0–1; null when nothing was graded */
  retention: number | null;
  /** reviews of cards that were already in review, i.e. not first-time learning */
  matureReviews: number;
}

/**
 * A streak counts back from today. Today not being studied yet doesn't break
 * it — it's still morning somewhere in everyone's day, and a counter that
 * resets at midnight and rebuilds at 9am reports the wrong thing all
 * morning. Missing yesterday does break it.
 */
function streakFrom(byDay: Map<string, number>, now: number): number {
  let streak = 0;
  let cursor = now;
  if (!byDay.get(dayKey(cursor))) {
    cursor = addDays(cursor, -1);
    if (!byDay.get(dayKey(cursor))) return 0;
  }
  while (byDay.get(dayKey(cursor))) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function longestStreakIn(days: DayStat[]): number {
  let best = 0;
  let run = 0;
  for (const day of days) {
    if (day.reviews > 0) {
      run++;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

export function summarizeReviews(
  entries: ReviewLogEntry[],
  windowDays: number,
  now = Date.now()
): StudyStats {
  const counts = new Map<string, number>();
  const times = new Map<string, number>();
  const ratings = { again: 0, hard: 0, good: 0, easy: 0 };
  let matureReviews = 0;
  let totalMs = 0;

  for (const e of entries) {
    const key = dayKey(e.at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    // A tab left open overnight would otherwise report an eight-hour card.
    const dur = Math.min(Math.max(e.durMs ?? 0, 0), 120000);
    times.set(key, (times.get(key) ?? 0) + dur);
    totalMs += dur;
    if (e.rating in ratings) ratings[e.rating as keyof typeof ratings]++;
    if (e.phase === "review") matureReviews++;
  }

  const days: DayStat[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const at = addDays(now, -i);
    const key = dayKey(at);
    days.push({
      key,
      at,
      reviews: counts.get(key) ?? 0,
      msSpent: times.get(key) ?? 0,
    });
  }

  const graded = ratings.again + ratings.hard + ratings.good + ratings.easy;
  const busiest = days.reduce<DayStat | null>(
    (best, d) => (d.reviews > 0 && (!best || d.reviews > best.reviews) ? d : best),
    null
  );

  return {
    days,
    totalReviews: entries.length,
    totalMs,
    activeDays: days.filter((d) => d.reviews > 0).length,
    streak: streakFrom(counts, now),
    longestStreak: longestStreakIn(days),
    busiestDay: busiest,
    ratings,
    retention: graded > 0 ? (graded - ratings.again) / graded : null,
    matureReviews,
  };
}

/** "1h 12m", "12m", "45s" — short enough to sit in a stat tile. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Buckets for the activity grid. Four steps rather than a continuous scale:
 * the question a heatmap answers is "did I, and roughly how much", and more
 * shades than that are harder to read, not more informative.
 */
export function activityLevel(reviews: number, busiest: number): 0 | 1 | 2 | 3 | 4 {
  if (reviews <= 0) return 0;
  if (busiest <= 0) return 1;
  const share = reviews / busiest;
  if (share > 0.66) return 4;
  if (share > 0.33) return 3;
  if (share > 0.1) return 2;
  return 1;
}
