// Finishing a deck should leave behind the cards that fought back, so the
// next sitting can be just those — without losing the ability to reset and
// take the whole deck again.

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
  saveTroubleList,
  loadTroubleList,
  clearTroubleList,
  saveCramSession,
  loadCramSession,
  clearCramSession,
  cramScopeId,
  STILL_LEARNING_MISSES,
} = await import("../src/lib/cramSession");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const base = "deckA,deckB:all";
const review = `${base}:review`;

// ---------- which cards get marked ----------
console.log("marking still-learning cards:");
{
  // A big session: most cards fine, twenty missed repeatedly.
  const misses = new Map<string, number>();
  for (let i = 0; i < 200; i++) {
    if (i < 20) misses.set(`c${i}`, 2 + (i % 3)); // missed 2, 3 or 4 times
    else if (i < 50) misses.set(`c${i}`, 1); // missed once
  }
  const stillLearning = [...misses.entries()]
    .filter(([, n]) => n >= STILL_LEARNING_MISSES)
    .map(([key]) => key);
  check(
    "only the repeatedly-missed cards are marked",
    stillLearning.length === 20,
    `${stillLearning.length} of 200`
  );
  check(
    "a single miss is not enough",
    !stillLearning.includes("c25"),
    "cards missed once are left out"
  );

  saveTroubleList(null, base, stillLearning);
  const back = await loadTroubleList(null, base);
  check("the list survives the finished session", back.length === 20);
}

// ---------- the list outlives the session ----------
console.log("\nthe list outlives the run that produced it:");
{
  saveCramSession(null, base, { order: ["deckA|c1"], strengths: [], total: 200 });
  clearCramSession(null, base); // what finishing the deck does
  check("the session itself is gone", (await loadCramSession(null, base)) === null);
  check(
    "but the still-learning list is not",
    (await loadTroubleList(null, base)).length === 20
  );
}

// ---------- a review run is a separate session ----------
console.log("\nreviewing does not disturb the full pass:");
{
  // Part-way through the whole deck…
  saveCramSession(null, base, {
    order: ["deckA|c5", "deckA|c6", "deckA|c7"],
    strengths: [["c1", 2]],
    total: 200,
  });
  // …then go off and review the hard ones.
  saveCramSession(null, review, {
    order: ["deckA|c0", "deckA|c1"],
    strengths: [],
    total: 20,
  });
  const full = await loadCramSession(null, base);
  const rev = await loadCramSession(null, review);
  check("the full pass is still where it was", full?.total === 200 && full.order.length === 3);
  check("the review run is its own thing", rev?.total === 20);
  check("their storage keys differ", cramScopeId(base) !== cramScopeId(review));

  // Finishing the review clears only the review.
  clearCramSession(null, review);
  check("finishing the review leaves the full pass", (await loadCramSession(null, base)) !== null);
  check("and the review is gone", (await loadCramSession(null, review)) === null);
}

// ---------- clearing ----------
console.log("\nclearing:");
{
  // A review round where you finally got them all: nothing left to mark.
  saveTroubleList(null, base, []);
  check(
    "an empty result clears the list rather than storing nothing",
    (await loadTroubleList(null, base)).length === 0
  );
  check("no leftover key in storage", !store.has("cramTrouble:" + base));
}
{
  saveTroubleList(null, base, ["c1", "c2"]);
  clearTroubleList(null, base);
  check("clearing by hand works", (await loadTroubleList(null, base)).length === 0);
}

// ---------- the pool a review run studies ----------
console.log("\nbuilding the review queue:");
{
  const all = ["c0", "c1", "c2", "c3", "c4"].map((key) => ({ key }));
  const troubleSet = new Set(["c1", "c3"]);
  const pool = all.filter((it) => troubleSet.has(it.key));
  check("it studies exactly the marked cards", pool.length === 2);

  // A stale list, whose cards have since been deleted.
  const stale = new Set(["gone1", "gone2"]);
  const stalePool = all.filter((it) => stale.has(it.key));
  check(
    "a stale list would otherwise leave an empty deck",
    stalePool.length === 0,
    "which is why it falls back to the full deck"
  );
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
