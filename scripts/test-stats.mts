// Study stats. The streak is the number people look at, so it's the one
// worth being careful about — an off-by-one there is the difference between
// "you've studied 40 days running" and losing someone's 40 days.
import {
  activityLevel,
  addDays,
  dayKey,
  formatDuration,
  summarizeReviews,
} from "../src/lib/stats";
import type { ReviewLogEntry } from "../src/lib/firestore";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const NOW = new Date(2026, 7, 12, 14, 0).getTime(); // Wed 12 Aug 2026, 2pm

const review = (
  daysAgo: number,
  over: Partial<ReviewLogEntry> = {}
): ReviewLogEntry => ({
  itemKey: "c1",
  rating: "good",
  at: addDays(NOW, -daysAgo),
  durMs: 5000,
  phase: "review",
  ...over,
});

// ---------- streaks ----------
console.log("streaks:");
{
  const today = summarizeReviews([review(0), review(1), review(2)], 30, NOW);
  check("three days running", today.streak === 3, `${today.streak}`);

  // Nothing today yet. Someone opening the app at breakfast has not lost
  // their streak, and telling them they have would be the worst possible
  // moment to be wrong.
  const morning = summarizeReviews([review(1), review(2), review(3)], 30, NOW);
  check(
    "an unstarted today doesn't break it",
    morning.streak === 3,
    `${morning.streak}`
  );

  const broken = summarizeReviews([review(0), review(2), review(3)], 30, NOW);
  check("but a missed day does", broken.streak === 1, `${broken.streak}`);

  check("no reviews, no streak", summarizeReviews([], 30, NOW).streak === 0);
  check(
    "a review long ago is not a streak",
    summarizeReviews([review(10)], 30, NOW).streak === 0
  );
  check(
    "several reviews on one day are still one day",
    summarizeReviews([review(0), review(0), review(0)], 30, NOW).streak === 1
  );

  const longest = summarizeReviews(
    [review(20), review(19), review(18), review(17), review(1), review(0)],
    30,
    NOW
  );
  check("the longest run is found", longest.longestStreak === 4, `${longest.longestStreak}`);
  check("while the current one is separate", longest.streak === 2);
}

// ---------- the window ----------
console.log("\nthe window:");
{
  const s = summarizeReviews([review(0), review(3)], 14, NOW);
  check("every day is present, empty ones included", s.days.length === 14);
  check("oldest first", s.days[0].at < s.days[13].at);
  check("today is last", dayKey(s.days[13].at) === dayKey(NOW));
  check("only the days studied count as active", s.activeDays === 2);
  check("and the totals are the reviews", s.totalReviews === 2);
  check(
    "the busiest day is identified",
    dayKey(summarizeReviews([review(0), review(3), review(3)], 14, NOW).busiestDay!.at) ===
      dayKey(addDays(NOW, -3))
  );
  check("with nothing studied there is no busiest day", summarizeReviews([], 7, NOW).busiestDay === null);
}

// ---------- how it's going ----------
console.log("\nhow it's going:");
{
  const mixed = summarizeReviews(
    [
      review(0, { rating: "again" }),
      review(0, { rating: "hard" }),
      review(0, { rating: "good" }),
      review(0, { rating: "easy" }),
    ],
    7,
    NOW
  );
  check("every grade is counted", mixed.ratings.again === 1 && mixed.ratings.easy === 1);
  check(
    "retention is everything that wasn't Again",
    mixed.retention === 0.75,
    `${mixed.retention}`
  );
  check("nothing graded means no figure at all", summarizeReviews([], 7, NOW).retention === null,
    "rather than a misleading 0%");
  check(
    "only cards already in review count as mature",
    summarizeReviews([review(0), review(0, { phase: "learn" })], 7, NOW).matureReviews === 1
  );

  // A tab left open overnight must not report an eight-hour card.
  const runaway = summarizeReviews([review(0, { durMs: 8 * 3600 * 1000 })], 7, NOW);
  check(
    "an abandoned card is capped",
    runaway.totalMs === 120000,
    formatDuration(runaway.totalMs)
  );
  const missing = summarizeReviews([review(0, { durMs: undefined as unknown as number })], 7, NOW);
  check("a missing duration counts as nothing", missing.totalMs === 0);
}

// ---------- presentation ----------
console.log("\npresentation:");
{
  check("seconds under a minute", formatDuration(45000) === "45s");
  check("minutes under an hour", formatDuration(12 * 60000) === "12m");
  check("hours and minutes past that", formatDuration(72 * 60000) === "1h 12m");
  check("nothing is zero seconds", formatDuration(0) === "0s");

  check("an empty day is level zero", activityLevel(0, 100) === 0);
  check("the busiest day is the top level", activityLevel(100, 100) === 4);
  check("a single review still shows", activityLevel(1, 100) === 1, "presence matters more than volume");
  check("the middle lands in the middle", activityLevel(50, 100) === 3);
  check("and a first-ever day doesn't divide by zero", activityLevel(5, 0) === 1);
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
