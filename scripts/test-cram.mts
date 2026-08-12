// Exercises cram-session persistence and the queue-restore logic.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
};

const { saveCramSession, loadCramSession, clearCramSession } = await import("../src/lib/cramSession");

const scope = "deckA,deckB:all";

// 1. round trip
saveCramSession(null, scope, { order: ["d1|c2", "d1|c3"], strengths: [["c1", 2]], total: 5 });
let s = (await await loadCramSession(null, scope))!;
console.log("restored order:", s.order, "| total:", s.total, "| strengths:", s.strengths);

// 2. restore filters out items that no longer exist
const all = [{ deckId: "d1", key: "c3" }, { deckId: "d1", key: "c9" }];
const byKey = new Map(all.map((i) => [`${i.deckId}|${i.key}`, i]));
const restored = s.order.map((k) => byKey.get(k)).filter(Boolean);
console.log("after a card was deleted, resumable items:", restored);

// 3. finishing clears it
clearCramSession(null, scope);
console.log("after finishing:", await loadCramSession(null, scope));

// 4. an old session is still resumed. Progress now ends only when the deck is
// finished, so coming back the next day picks up where you left off.
store.set("cramSession:" + scope, JSON.stringify({
  order: ["d1|c1"], strengths: [], total: 1,
  savedAt: Date.now() - 26 * 60 * 60 * 1000,
}));
console.log("a day-old session still resumes:", await loadCramSession(null, scope));

// 5. corrupt data doesn't throw
store.set("cramSession:" + scope, "{not json");
console.log("corrupt session:", await loadCramSession(null, scope));
