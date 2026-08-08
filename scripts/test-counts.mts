// Walks the New/Learn/Due counters through the exact scenarios from the spec.
import { rate, type SrsState } from "../src/lib/srs";
import { startOfStudyDay } from "../src/lib/settings";

const NEW_PER_DAY = 60;
const now = Date.now();
const dayStart = startOfStudyDay(now);
const nextDayStart = dayStart + 86400000;

function counts(states: (SrsState | undefined)[], totalCards: number) {
  let newRaw = 0, learn = 0, due = 0, newToday = 0;
  for (const s of states) {
    if (s && (s.firstSeen ?? 0) >= dayStart) newToday++;
    if (!s || s.reps === 0) { newRaw++; continue; }
    if (s.phase === "review") { if (s.due <= now) due++; }
    else if (s.due < nextDayStart) learn++;
  }
  newRaw += totalCards - states.length; // untouched cards
  const allowance = Math.max(0, NEW_PER_DAY - newToday);
  return { New: Math.min(newRaw, allowance), Learn: learn, Due: due };
}

const TOTAL = 200;
let states: (SrsState | undefined)[] = [];
console.log("start (200 unseen, limit 60):", counts(states, TOTAL));

// Study one new card, press Good -> enters a 10m learning step
// NOTE: with a single learning step ("10m"), Good on a new card advances past
// the only step and graduates it straight to review — so it lands in Due
// (tomorrow), not Learn. Two steps ("1m 10m") would leave it in Learn.
let c1 = rate(null, "good", now);
states = [c1];
console.log("after 1 new card graded Good:", counts(states, TOTAL),
  "-> phase:", c1.phase, "due in", ((c1.due - now) / 86400000).toFixed(1), "d");

// Study a second new card and get it wrong -> Again, back to first step
let c2 = rate(null, "again", now);
states = [c1, c2];
console.log("after a 2nd new card graded Again:", counts(states, TOTAL));

// A card reviewed on a past day that is due today
const yesterday = now - 86400000;
let c3 = rate(null, "good", yesterday - 60000);
c3 = rate(c3, "good", yesterday);            // graduated
c3 = { ...c3, due: now - 1000 };             // its day has arrived
states = [c1, c2, c3];
console.log("with a review card due today:", counts(states, TOTAL));

// Lapse it: Again on a review card -> relearning, joins Learn
const c3Lapsed = rate(c3, "again", now);
states = [c1, c2, c3Lapsed];
console.log("after failing that review (lapse):", counts(states, TOTAL),
  "| phase:", c3Lapsed.phase, "lapses:", c3Lapsed.lapses);

// Six new cards introduced today -> New drops to 54
states = Array.from({ length: 6 }, () => rate(null, "good", now));
console.log("\nafter introducing 6 new cards:", counts(states, TOTAL));
console.log("   ^ New should be 54 = 60 limit - 6 introduced today");

// Two-step learning keeps a card in Learn between steps.
const twoStep = { learnStepsMin: [1, 10], relearnStepsMin: [10], maxIntervalDays: 36500, desiredRetention: 0.9 };
const mid = rate(null, "good", now, twoStep);
console.log("two-step preset, Good on a new card:", counts([mid], TOTAL),
  "-> phase:", mid.phase, "due in", Math.round((mid.due - now) / 60000), "min");
