// Losing typed lecture notes is the worst thing this app could do. These
// check the local draft actually holds under the ways a save gets cut off:
// a closed tab, a crash, no signal, and storage that refuses to cooperate.

let store = new Map<string, string>();
let failWrites = false;
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    if (failWrites) throw new Error("QuotaExceededError");
    store.set(k, v);
  },
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

const { saveDraft, loadDraft, clearDraft, draftIsUnsaved } = await import(
  "../src/lib/noteDrafts"
);
import type { Note } from "../src/types";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const note = (over: Partial<Note> = {}): Note => ({
  id: "n1",
  title: "Cardiac cycle",
  className: "Physiology",
  content: "<p>The ventricles contract…</p>",
  slides: [],
  cardsMade: 0,
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

// ---------- the basic promise ----------
console.log("a draft survives the session:");
{
  store.clear();
  const ok = saveDraft("n1", note());
  check("typing is stored immediately", ok);
  const back = loadDraft("n1");
  check("and comes back intact", back?.content === note().content);
  check("with everything else too",
    back?.title === "Cardiac cycle" && back?.className === "Physiology");
  check("stamped with a time", (back?.savedAt ?? 0) > 0);
}

// ---------- the crash case ----------
console.log("\nthe tab died before the save landed:");
{
  store.clear();
  const stored = note({ content: "<p>first half</p>", updatedAt: 5000 });
  // You keep typing; the debounce never fires.
  saveDraft("n1", { ...stored, content: "<p>first half and the rest</p>" });
  const draft = loadDraft("n1")!;
  check(
    "the draft is recognised as unsaved work",
    draftIsUnsaved(draft, stored),
    "so it gets restored on reopen"
  );
}
{
  // The save did land — the draft is just a leftover.
  store.clear();
  const stored = note({ content: "<p>all of it</p>", updatedAt: 5000 });
  saveDraft("n1", stored);
  const draft = loadDraft("n1")!;
  check(
    "an identical draft is not treated as unsaved",
    !draftIsUnsaved(draft, stored),
    "no spurious 'restored' banner"
  );
}
{
  // Another device saved after this draft was written.
  store.clear();
  saveDraft("n1", note({ content: "<p>old local edit</p>" }));
  const draft = loadDraft("n1")!;
  const newerRemote = note({
    content: "<p>newer, from the laptop</p>",
    updatedAt: draft.savedAt + 60000,
  });
  check(
    "a stale draft does not clobber a newer server copy",
    !draftIsUnsaved(draft, newerRemote),
    "the other device wins"
  );
}

// ---------- slides ----------
console.log("\nslide notes are covered too:");
{
  store.clear();
  const withSlides = note({
    slides: [
      { id: "s1", imagePath: "p1", imageUrl: "u1", note: "<p>slide one</p>" },
      { id: "s2", imagePath: "p2", imageUrl: "u2", note: "" },
    ] as Note["slides"],
    updatedAt: 5000,
  });
  saveDraft("n1", withSlides);
  const back = loadDraft("n1")!;
  check("slides round trip", back.slides.length === 2);
  check("and their notes with them", back.slides[0].note === "<p>slide one</p>");

  const stored = note({
    slides: [
      { id: "s1", imagePath: "p1", imageUrl: "u1", note: "" },
      { id: "s2", imagePath: "p2", imageUrl: "u2", note: "" },
    ] as Note["slides"],
    updatedAt: 5000,
  });
  check(
    "a note typed under a slide counts as unsaved work",
    draftIsUnsaved(back, stored)
  );
}

// ---------- only cleared once it is really saved ----------
console.log("\nclearing:");
{
  store.clear();
  saveDraft("n1", note());
  clearDraft("n1");
  check("a confirmed save removes the draft", loadDraft("n1") === null);
  check("and leaves nothing behind", store.size === 0);
}

// ---------- storage that refuses ----------
console.log("\nwhen the browser won't store anything:");
{
  store.clear();
  failWrites = true;
  const ok = saveDraft("n1", note());
  failWrites = false;
  check(
    "a refusal is reported rather than swallowed",
    ok === false,
    "so the UI can warn instead of claiming it's safe"
  );
}
{
  // Full storage: the oldest drafts give way so this one fits.
  store.clear();
  store.set("noteDraft:old1", JSON.stringify({ savedAt: 1, content: "x" }));
  store.set("noteDraft:old2", JSON.stringify({ savedAt: 2, content: "x" }));
  let calls = 0;
  const realSet = (globalThis as unknown as { localStorage: Storage })
    .localStorage.setItem;
  (globalThis as unknown as { localStorage: Storage }).localStorage.setItem = ((
    k: string,
    v: string
  ) => {
    // Fail the first attempt only, as a full quota would.
    if (k.startsWith("noteDraft:") && calls++ === 0) {
      throw new Error("QuotaExceededError");
    }
    store.set(k, v);
  }) as Storage["setItem"];
  const ok = saveDraft("n1", note());
  (globalThis as unknown as { localStorage: Storage }).localStorage.setItem =
    realSet;
  check("a full store makes room and keeps the note", ok, `${store.size} keys left`);
  check("the note being typed is the one that survived", loadDraft("n1") !== null);
}

// ---------- corrupt data must not break the editor ----------
console.log("\nbad data:");
{
  store.clear();
  store.set("noteDraft:n1", "{not json");
  check("unparseable drafts are ignored", loadDraft("n1") === null);
  store.set("noteDraft:n1", JSON.stringify({ nonsense: true }));
  check("drafts missing their fields are ignored", loadDraft("n1") === null);
  store.set(
    "noteDraft:n1",
    JSON.stringify({ content: "old", savedAt: Date.now() - 400 * 864e5 })
  );
  check("drafts older than the retention window are dropped", loadDraft("n1") === null);
  check("and cleaned up", !store.has("noteDraft:n1"));
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
