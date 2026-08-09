// A card you keep missing has to earn its way out. Two misses then one
// correct answer used to retire it outright in flashcards mode, because a
// quick answer was worth double.

const MASTERY = 2;
const MAX_EXTRA_REPS = 2;
const RETRY_GAP = 3;
const SPACED_GAP = 12;
const FAST_ANSWER_MS = 7000;

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

interface Sim {
  queue: string[];
  strengths: Map<string, number>;
  misses: Map<string, number>;
  total: number;
}

function reinsert(prev: string[], item: string, at: number): string[] {
  const rest = prev.slice(1);
  const pos = Math.min(at, rest.length);
  return [...rest.slice(0, pos), item, ...rest.slice(pos)];
}

const requiredFor = (s: Sim, key: string) =>
  MASTERY + Math.min(s.misses.get(key) ?? 0, MAX_EXTRA_REPS);

/** Mirrors markCram: the flashcards path, with its speed bonus. */
function markCram(s: Sim, correct: boolean, answerMs = 20000) {
  const key = s.queue[0];
  const st = s.strengths.get(key) ?? 0;
  const missed = (s.misses.get(key) ?? 0) > 0;
  if (!correct) {
    s.misses.set(key, (s.misses.get(key) ?? 0) + 1);
    s.strengths.set(key, 0);
    s.queue = reinsert(s.queue, key, RETRY_GAP);
    return;
  }
  const fast = !missed && answerMs > 0 && answerMs < FAST_ANSWER_MS;
  const strength = st + (fast ? 2 : 1);
  s.strengths.set(key, strength);
  s.queue =
    strength >= requiredFor(s, key)
      ? s.queue.slice(1)
      : reinsert(
          s.queue,
          key,
          missed
            ? Math.max(SPACED_GAP, s.queue.length - 2)
            : Math.max(8, s.queue.length - 2)
        );
}

function fresh(n: number): Sim {
  return {
    queue: Array.from({ length: n }, (_, i) => `c${i}`),
    strengths: new Map(),
    misses: new Map(),
    total: n,
  };
}

function progress(s: Sim) {
  let earned = 0;
  let needed = s.total * MASTERY;
  for (const [key, strength] of s.strengths) {
    const required = requiredFor(s, key);
    needed += required - MASTERY;
    earned += Math.min(strength, required);
  }
  return Math.min(100, Math.round((earned / Math.max(needed, 1)) * 100));
}

// ---------- the reported sequence ----------
console.log("wrong, wrong, then right (flashcards, answered quickly):");
{
  const s = fresh(20);
  const card = s.queue[0];
  markCram(s, false);
  // bring it back to the front to answer it again
  s.queue = [card, ...s.queue.filter((c) => c !== card)];
  markCram(s, false);
  s.queue = [card, ...s.queue.filter((c) => c !== card)];
  markCram(s, true, 1200); // fast — this used to retire it outright

  check("it is still in the session", s.queue.includes(card));
  check("its debt grew to 4 correct answers", requiredFor(s, card) === 4, `${requiredFor(s, card)}`);
  check("the speed bonus did not apply", s.strengths.get(card) === 1, `strength ${s.strengths.get(card)}`);
  const pos = s.queue.indexOf(card);
  check(
    "it comes back much later, not right away",
    pos >= SPACED_GAP,
    `${pos} cards away`
  );
}

// ---------- it does eventually leave ----------
{
  const s = fresh(20);
  const card = s.queue[0];
  markCram(s, false);
  s.queue = [card, ...s.queue.filter((c) => c !== card)];
  markCram(s, false);
  let answers = 0;
  while (s.queue.includes(card) && answers < 10) {
    s.queue = [card, ...s.queue.filter((c) => c !== card)];
    markCram(s, true, 1200);
    answers++;
  }
  check(
    "four correct answers clear a twice-missed card",
    !s.queue.includes(card) && answers === 4,
    `${answers} correct answers`
  );
}

// ---------- a card you know is unaffected ----------
{
  const s = fresh(20);
  const card = s.queue[0];
  markCram(s, true, 1200);
  check(
    "a fast correct answer still retires a clean card at once",
    !s.queue.includes(card),
    "speed bonus intact where it belongs"
  );
}
{
  const s = fresh(20);
  const card = s.queue[0];
  markCram(s, true, 20000);
  check("a slow correct answer needs a second pass", s.queue.includes(card));
  check("and comes back near the end", s.queue.indexOf(card) >= 8);
}

// ---------- a missed card comes straight back for its retry ----------
{
  const s = fresh(20);
  const card = s.queue[0];
  markCram(s, false);
  check(
    "a card you just missed returns soon",
    s.queue.indexOf(card) === RETRY_GAP,
    `${s.queue.indexOf(card)} cards away`
  );
}

// ---------- the bar reflects the extra work ----------
console.log("\nprogress bar:");
{
  const s = fresh(20);
  const before = progress(s);
  markCram(s, false);
  const after = progress(s);
  check("missing a card lowers progress", after <= before, `${before}% → ${after}%`);
}
{
  const s = fresh(4);
  // Master every card cleanly.
  for (let pass = 0; pass < 2; pass++) {
    for (const card of [...new Set(s.queue)]) {
      s.queue = [card, ...s.queue.filter((c) => c !== card)];
      markCram(s, true, 20000);
    }
  }
  check("clearing the deck reads 100%", progress(s) === 100 && s.queue.length === 0, `${progress(s)}%`);
}
{
  // The bar must not reach 100% while a missed card still owes work.
  const s = fresh(2);
  const [a, b] = s.queue;
  markCram(s, false); // a missed -> needs 3
  s.queue = [b, ...s.queue.filter((c) => c !== b)];
  markCram(s, true, 20000);
  s.queue = [b, ...s.queue.filter((c) => c !== b)];
  markCram(s, true, 20000); // b done
  s.queue = [a, ...s.queue.filter((c) => c !== a)];
  markCram(s, true, 20000);
  s.queue = [a, ...s.queue.filter((c) => c !== a)];
  markCram(s, true, 20000); // a at strength 2 of 3
  check(
    "not 100% while a missed card still owes a rep",
    progress(s) < 100 && s.queue.includes(a),
    `${progress(s)}%`
  );
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
