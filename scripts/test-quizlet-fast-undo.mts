// A first-try "Got it" answered promptly should retire the card. A flat 7s
// budget failed that for anything longer than a phrase, because reading the
// card ate the whole allowance.

const FAST_ANSWER_BASE_MS = 9000;
const FAST_ANSWER_CAP_MS = 28000;
const READING_WPM = 160;
const MASTERY = 2;
const MAX_EXTRA_REPS = 2;

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

function fastThresholdMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(
    FAST_ANSWER_CAP_MS,
    FAST_ANSWER_BASE_MS + (words / READING_WPM) * 60000
  );
}

// Real cards, roughly the length of what's in a medical deck.
const short = "Femur";
const medium =
  "On which day(s) following fertilization does implantation occur? [...]";
const long =
  "From zygote to gastrula, what are the various stages of development and " +
  "when does implantation occur? The blastocyst implants into the " +
  "endometrium at around day six, completing by day ten, after the morula " +
  "stage has given way to a fluid filled cavity known as the blastocoel.";

console.log("allowance scales with how much there is to read:");
for (const [name, text] of [
  ["short (1 word)", short],
  ["medium (10 words)", medium],
  ["long (50 words)", long],
] as const) {
  const ms = fastThresholdMs(text);
  console.log(`      ${name.padEnd(20)} ${(ms / 1000).toFixed(1)}s`);
}

check(
  "the allowance grows with the card",
  fastThresholdMs(short) < fastThresholdMs(medium) &&
    fastThresholdMs(medium) < fastThresholdMs(long)
);
check(
  "every card gets more than the old flat 7s",
  fastThresholdMs(short) > 7000,
  `shortest is ${(fastThresholdMs(short) / 1000).toFixed(1)}s`
);
check(
  "and it stays bounded",
  fastThresholdMs(long) <= FAST_ANSWER_CAP_MS,
  `${(fastThresholdMs(long) / 1000).toFixed(1)}s`
);

// The reported case: answered right, first try, at a sensible pace.
console.log("\nfirst-try correct at a realistic pace:");
function retiresFirstTry(text: string, answerMs: number, missed = false) {
  const fast = !missed && answerMs > 0 && answerMs < fastThresholdMs(text);
  const strength = 0 + (fast ? 2 : 1);
  const required = MASTERY + Math.min(missed ? 1 : 0, MAX_EXTRA_REPS);
  return strength >= required;
}
check(
  "medium card answered in 9s retires (used to come back)",
  retiresFirstTry(medium, 9000),
  "9s vs a 9.0s allowance was the old failure"
);
check("short card answered in 3s retires", retiresFirstTry(short, 3000));
check("long card answered in 15s retires", retiresFirstTry(long, 15000));
check("dawdling on a short card still needs a second look", !retiresFirstTry(short, 30000));
check("labouring over a long card needs one too", !retiresFirstTry(long, 45000));
check("a previously missed card never retires first try", !retiresFirstTry(medium, 1000, true));

// ---------- undo ----------
// Undo has to put back the queue, the strength, the miss count and the tally.
console.log("\nundo:");
interface State {
  queue: string[];
  strengths: Map<string, number>;
  misses: Map<string, number>;
  stats: { answers: number; correct: number; wrong: number };
}
interface Entry {
  queue: string[];
  cramKey: string;
  strength?: number;
  misses?: number;
  stats: { answers: number; correct: number; wrong: number };
}

const history: Entry[] = [];
const st: State = {
  queue: ["a", "b", "c"],
  strengths: new Map(),
  misses: new Map(),
  stats: { answers: 0, correct: 0, wrong: 0 },
};

function push(s: State) {
  const cramKey = s.queue[0];
  history.push({
    queue: [...s.queue],
    cramKey,
    strength: s.strengths.get(cramKey),
    misses: s.misses.get(cramKey),
    stats: { ...s.stats },
  });
}
function answerWrong(s: State) {
  push(s);
  const key = s.queue[0];
  s.misses.set(key, (s.misses.get(key) ?? 0) + 1);
  s.strengths.set(key, 0);
  s.stats = { answers: s.stats.answers + 1, correct: s.stats.correct, wrong: s.stats.wrong + 1 };
  s.queue = [...s.queue.slice(1), key];
}
function undo(s: State) {
  const last = history.pop();
  if (!last) return;
  const restore = (map: Map<string, number>, v: number | undefined) => {
    if (v === undefined) map.delete(last.cramKey);
    else map.set(last.cramKey, v);
  };
  restore(s.strengths, last.strength);
  restore(s.misses, last.misses);
  s.stats = last.stats;
  s.queue = last.queue;
}

answerWrong(st);
check("the answer registered", st.misses.get("a") === 1 && st.queue[0] === "b");
undo(st);
check("undo returns to the same card", st.queue[0] === "a");
check("undo removes the miss it recorded", st.misses.get("a") === undefined);
check("undo removes the strength it recorded", st.strengths.get("a") === undefined);
check(
  "undo rolls the tally back",
  st.stats.answers === 0 && st.stats.wrong === 0,
  JSON.stringify(st.stats)
);

// Undo twice, across different cards.
answerWrong(st);
answerWrong(st);
check("two answers in", st.stats.answers === 2, JSON.stringify(st.stats));
undo(st);
undo(st);
check("both undone", st.stats.answers === 0 && st.queue[0] === "a" && st.misses.size === 0);
undo(st);
check("undo past the start is harmless", st.queue[0] === "a");

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
