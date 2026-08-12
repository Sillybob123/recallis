// The cram session has to survive leaving the deck, and the progress bar has
// to move when you actually make progress.

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

const {
  cramScopeId,
  cramProgress,
  saveCramSession,
  loadCramSession,
  clearCramSession,
} = await import("../src/lib/cramSession");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---------- scope ids ----------
console.log("scope ids:");
{
  const many = Array.from({ length: 60 }, (_, i) => `deck${i}`).join(",");
  const id = cramScopeId(`${many}:all`);
  check("long multi-deck scope yields a short id", id.length <= 16, `${id} (${id.length})`);
  check("id is stable", cramScopeId(`${many}:all`) === id);
  check("id has no path separator", !id.includes("/"));
  const ids = new Set(
    Array.from({ length: 5000 }, (_, i) => cramScopeId(`deck-${i}:all`))
  );
  check("5000 distinct scopes give 5000 distinct ids", ids.size === 5000, `${ids.size}`);
  check(
    "cards-only and all are different sessions",
    cramScopeId("d1:cards") !== cramScopeId("d1:all")
  );
}

// ---------- local round trip (no uid: the offline / signed-out path) ----------
console.log("\nlocal persistence:");
{
  const scope = "deckA:all";
  saveCramSession(null, scope, {
    order: ["deckA|c2", "deckA|c3"],
    strengths: [["c1", 2], ["c2", 1]],
    total: 3,
  });
  const back = await loadCramSession(null, scope);
  check("resumes after a refresh", back?.order.length === 2, JSON.stringify(back?.order));
  check("keeps per-card strength", back?.strengths.length === 2);
  check("keeps the original total", back?.total === 3);
  check("stamps savedAt", (back?.savedAt ?? 0) > 0);
}

// ---------- no expiry: an old session still resumes ----------
{
  const scope = "deckOld:all";
  saveCramSession(null, scope, {
    order: ["deckOld|c1"],
    strengths: [],
    total: 4,
  });
  // Backdate it well past the old 12-hour cutoff.
  const raw = JSON.parse(store.get("cramSession:" + scope)!);
  raw.savedAt = Date.now() - 30 * 24 * 60 * 60 * 1000;
  store.set("cramSession:" + scope, JSON.stringify(raw));
  const back = await loadCramSession(null, scope);
  check("a month-old unfinished session still resumes", back !== null);
}

// ---------- finishing clears it ----------
{
  const scope = "deckB:all";
  saveCramSession(null, scope, { order: ["deckB|c1"], strengths: [], total: 1 });
  clearCramSession(null, scope);
  check("finishing drops the local copy", (await loadCramSession(null, scope)) === null);
  check("nothing left in storage", !store.has("cramSession:" + scope));
}

// ---------- an empty queue is never a resumable session ----------
{
  const scope = "deckC:all";
  store.set(
    "cramSession:" + scope,
    JSON.stringify({ order: [], strengths: [], total: 5, savedAt: Date.now() })
  );
  check("empty order is not resumed", (await loadCramSession(null, scope)) === null);
}

// ---------- progress metric ----------
// Learn/flashcards retire a card after two correct answers; a wrong answer
// resets it. The bar should track that, not the queue length.
console.log("\nprogress metric (20-card deck):");
const MASTERY = 2;
const TOTAL = 20;

function queueProgress(queueLen: number) {
  return Math.round(((TOTAL - queueLen) / TOTAL) * 100);
}
function masteryProgress(strengths: Map<string, number>) {
  let earned = 0;
  for (const v of strengths.values()) earned += Math.min(v, MASTERY);
  return Math.min(100, Math.round((earned / (TOTAL * MASTERY)) * 100));
}

const strengths = new Map<string, number>();
let queue = Array.from({ length: TOTAL }, (_, i) => `c${i}`);

// First pass: every card answered correctly once. Each goes back for its
// second look, so the queue is exactly as long as it started.
for (const card of [...queue]) {
  strengths.set(card, (strengths.get(card) ?? 0) + 1);
}
check(
  "one correct pass over every card",
  queueProgress(queue.length) === 0 && masteryProgress(strengths) === 50,
  `old bar ${queueProgress(queue.length)}%, new bar ${masteryProgress(strengths)}%`
);

// Second pass: each card hits mastery and leaves.
for (const card of [...queue]) {
  strengths.set(card, (strengths.get(card) ?? 0) + 1);
  queue = queue.filter((c) => c !== card);
}
check(
  "finishing the deck reads 100%",
  masteryProgress(strengths) === 100 && queue.length === 0,
  `${masteryProgress(strengths)}%`
);

// Getting one wrong takes its credit back.
strengths.set("c0", 0);
check(
  "a missed card gives its progress back",
  masteryProgress(strengths) === 95,
  `${masteryProgress(strengths)}%`
);

// Every answer should move the bar, which was the actual complaint.
{
  const s = new Map<string, number>();
  const seen: number[] = [];
  for (let i = 0; i < TOTAL; i++) {
    s.set(`c${i}`, 1);
    seen.push(masteryProgress(s));
  }
  const alwaysMoves = seen.every((v, i) => i === 0 || v > seen[i - 1]);
  check("the bar moves on every card answered", alwaysMoves, seen.slice(0, 6).join("% → ") + "%");
}

// ---------- the number you watch ----------
// A card leaves a cram run after two correct answers with time in between,
// so a bar counting only retired cards sits still through a dozen answers.
// It counts half-steps instead, which means every correct answer moves it.
console.log("\nthe progress bar:");
{
  const MASTERY = 2;
  const pct = (strengths: number[], total: number) =>
    cramProgress(strengths, total, MASTERY);

  check("nothing answered, nothing shown", pct([], 10) === 0);
  check(
    "one correct answer out of ten cards already moves it",
    pct([1], 10) === 5,
    `${pct([1], 10)}% — half a card of twenty half-steps`
  );
  check("the second answer on that card moves it again", pct([2], 10) === 10);
  check(
    "so a run where every card is half-done is halfway",
    pct([1, 1, 1, 1], 4) === 50
  );
  check("and all mastered is a hundred", pct([2, 2, 2, 2], 4) === 100);
  check(
    "extra correct answers past mastery don't overshoot",
    pct([5, 5], 2) === 100,
    "a card answered right five times is still one card"
  );
  check("an empty deck doesn't divide by zero", pct([1], 0) === 0);

  // The property that matters: answering correctly never moves it backwards.
  let previous = -1;
  let monotonic = true;
  const strengths = [0, 0, 0, 0];
  for (let i = 0; i < 8; i++) {
    strengths[i % 4] = Math.min(strengths[i % 4] + 1, MASTERY);
    const now = pct(strengths, 4);
    if (now < previous) monotonic = false;
    previous = now;
  }
  check("it only ever goes up as you answer", monotonic && previous === 100);
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
