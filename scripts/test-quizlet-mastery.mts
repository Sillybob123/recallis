// A card you keep missing has to earn its way out — but by showing recall
// after a real gap, not by being drilled a fixed number of times. Quizlet's
// Learn models the interval since the last answer rather than counting
// correct answers, and counting was making sessions far longer than the
// evidence justified.

const MASTERY = 2;
const MAX_CORRECT_ANSWERS = 3;
const SPACED_RECALL_MS = 2 * 60 * 1000;
const SPACED_RECALL_CARDS = 10;
const SHORT_QUEUE = 6;
const RETRY_GAP = 3;
const SPACED_GAP = 12;
const FAST_ANSWER_MS = 9000;

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

interface Sim {
  queue: string[];
  strengths: Map<string, number>;
  misses: Map<string, number>;
  lastSeen: Map<string, { at: number; n: number }>;
  answers: number;
  now: number;
  shown: Map<string, number>;
}

function fresh(n: number): Sim {
  return {
    queue: Array.from({ length: n }, (_, i) => `c${i}`),
    strengths: new Map(),
    misses: new Map(),
    lastSeen: new Map(),
    answers: 0,
    now: Date.now(),
    shown: new Map(),
  };
}

function reinsert(prev: string[], item: string, at: number): string[] {
  const rest = prev.slice(1);
  const pos = Math.min(at, rest.length);
  return [...rest.slice(0, pos), item, ...rest.slice(pos)];
}

function isSpaced(s: Sim, key: string, strength: number) {
  const last = s.lastSeen.get(key);
  if (!last) return strength > 0;
  if (s.queue.length <= SHORT_QUEUE) return true;
  return (
    s.now - last.at >= SPACED_RECALL_MS ||
    s.answers - last.n >= SPACED_RECALL_CARDS
  );
}
const retires = (strength: number, spaced: boolean) =>
  strength >= MASTERY && (spaced || strength >= MAX_CORRECT_ANSWERS);

/** markCram: answer the card at the front. */
function answer(s: Sim, correct: boolean, answerMs = 30000) {
  const key = s.queue[0];
  s.shown.set(key, (s.shown.get(key) ?? 0) + 1);
  const st = s.strengths.get(key) ?? 0;
  const missed = (s.misses.get(key) ?? 0) > 0;
  const spaced = isSpaced(s, key, st);
  s.answers += 1;
  s.lastSeen.set(key, { at: s.now, n: s.answers });
  if (!correct) {
    s.misses.set(key, (s.misses.get(key) ?? 0) + 1);
    s.strengths.set(key, 0);
    s.queue = reinsert(s.queue, key, RETRY_GAP);
    return;
  }
  const knewIt = !missed && st === 0 && answerMs > 0 && answerMs < FAST_ANSWER_MS;
  const strength = st + 1;
  s.strengths.set(key, strength);
  s.queue =
    knewIt || retires(strength, spaced)
      ? s.queue.slice(1)
      : reinsert(
          s.queue,
          key,
          missed ? Math.max(SPACED_GAP, s.queue.length - 2) : Math.max(8, s.queue.length - 2)
        );
}

/**
 * Brings `key` to the front, as answering the cards in between would —
 * including advancing the answer counter, since those answers really happen.
 */
function jumpTo(s: Sim, key: string, minutes = 0) {
  s.now += minutes * 60 * 1000;
  s.answers += Math.max(0, s.queue.indexOf(key));
  s.queue = [key, ...s.queue.filter((k) => k !== key)];
}

// ---------- the reported case ----------
console.log("wrong → right → (4 minutes) → right:");
{
  const s = fresh(20);
  const card = s.queue[0];
  answer(s, false);                 // missed it
  jumpTo(s, card, 0.5);             // comes back within a few cards
  answer(s, true);                  // right, but only 30s later
  check("a prompt correction is not enough on its own", s.queue.includes(card));
  jumpTo(s, card, 4);               // four minutes later
  answer(s, true);
  check(
    "getting it right after a real gap finishes it",
    !s.queue.includes(card),
    `${s.shown.get(card)} showings in total`
  );
  check("that is three showings, not five", s.shown.get(card) === 3);
}

// ---------- the old behaviour is genuinely gone ----------
console.log("\nno more fixed drilling:");
{
  const s = fresh(20);
  const card = s.queue[0];
  answer(s, false);
  jumpTo(s, card, 0.2);
  answer(s, false);                 // missed twice
  jumpTo(s, card, 0.2);
  answer(s, true);
  jumpTo(s, card, 5);
  answer(s, true);
  check(
    "twice-missed still clears in two spaced corrections",
    !s.queue.includes(card),
    `${s.shown.get(card)} showings (was 5 under the old rule)`
  );
}

// ---------- unspaced answers must not clear it ----------
console.log("\nspacing is what counts:");
{
  // The pathological case: the card keeps coming straight back with no time
  // and no cards in between. Nothing here is spaced, so the cap has to be
  // what ends it.
  const s = fresh(20);
  const card = s.queue[0];
  answer(s, false);
  s.queue = [card, ...s.queue.filter((k) => k !== card)];
  answer(s, true);
  check("a rapid correction leaves it in the session", s.queue.includes(card));
  s.queue = [card, ...s.queue.filter((k) => k !== card)];
  answer(s, true);
  check("a second rapid one still isn't recall", s.queue.includes(card));
  s.queue = [card, ...s.queue.filter((k) => k !== card)];
  answer(s, true);
  check(
    "the cap ends it rather than looping forever",
    !s.queue.includes(card),
    `worst case ${s.shown.get(card)} showings, and only with no gap at all`
  );
}
{
  // What actually happens: a missed card is put back a dozen cards away, so
  // by the time it returns the gap is real and one correction finishes it.
  const s = fresh(20);
  const card = s.queue[0];
  answer(s, false);
  jumpTo(s, card);
  answer(s, true);
  jumpTo(s, card);
  answer(s, true);
  check(
    "in a normal session the queue supplies the gap by itself",
    !s.queue.includes(card),
    `${s.shown.get(card)} showings without waiting for the clock`
  );
}
{
  // Ten other cards in between counts as spacing even when the clock is fast.
  const s = fresh(30);
  const card = s.queue[0];
  answer(s, false);
  jumpTo(s, card, 0.1);
  answer(s, true);
  s.answers += SPACED_RECALL_CARDS; // answered ten other cards
  jumpTo(s, card, 0);
  answer(s, true);
  check("ten intervening cards count as a gap", !s.queue.includes(card));
}

// ---------- cards you know are untouched ----------
console.log("\nknown cards still leave at once:");
{
  const s = fresh(20);
  const card = s.queue[0];
  answer(s, true, 1200);
  check("a quick first-try answer retires the card", !s.queue.includes(card));
  check("one showing", s.shown.get(card) === 1);
}
{
  const s = fresh(20);
  const card = s.queue[0];
  answer(s, true, 40000);          // right but laboured
  check("a slow first answer needs a second, spaced look", s.queue.includes(card));
  jumpTo(s, card, 3);
  answer(s, true);
  check("and then it is done", !s.queue.includes(card), `${s.shown.get(card)} showings`);
}

// ---------- a short queue cannot space anything ----------
console.log("\na nearly finished session:");
{
  const s = fresh(3);
  const card = s.queue[0];
  answer(s, false);
  jumpTo(s, card, 0.1);
  answer(s, true);
  jumpTo(s, card, 0.1);
  answer(s, true);
  check(
    "the last few cards don't get stuck demanding gaps they can't have",
    !s.queue.includes(card),
    `${s.shown.get(card)} showings`
  );
}

// ---------- whole-session cost ----------
console.log("\nwhat a session costs:");
{
  const s = fresh(20);
  // Miss a quarter of them once, answer everything else promptly.
  const missOnce = new Set(["c0", "c1", "c2", "c3", "c4"]);
  let guard = 0;
  while (s.queue.length && guard++ < 400) {
    const key = s.queue[0];
    const shouldMiss = missOnce.has(key) && (s.shown.get(key) ?? 0) === 0;
    s.now += 25 * 1000; // a card every 25 seconds
    answer(s, !shouldMiss, shouldMiss ? 30000 : 3000);
  }
  const totalShowings = [...s.shown.values()].reduce((a, b) => a + b, 0);
  check(
    "a 20-card deck with 5 misses finishes in a sane number of answers",
    s.queue.length === 0 && totalShowings <= 40,
    `${totalShowings} showings for 20 cards`
  );
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
