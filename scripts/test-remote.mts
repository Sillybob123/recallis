// Study remotes. Two failures would be bad enough to matter: a held button
// grading a run of cards you never read, and a remote whose keys the app
// silently ignores because nobody checked what the thing actually sends.
import {
  actionForButton,
  actionForKey,
  bindButton,
  bindKey,
  buttonLabel,
  clearAction,
  DEFAULT_MAPPING,
  keyLabel,
  normalizeKey,
  pressedSince,
  REMOTE_ACTIONS,
  REMOTE_PRESETS,
  type RemoteMapping,
} from "../src/lib/remote";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---------- the keys real remotes send ----------
console.log("what actual remotes send:");
{
  const m = DEFAULT_MAPPING;
  // A presentation clicker — the cheapest thing that works.
  check("PageDown advances", actionForKey(m, "PageDown") === "advance");
  check("PageUp undoes", actionForKey(m, "PageUp") === "undo");
  check("Space advances", actionForKey(m, " ") === "advance");
  check("Enter advances", actionForKey(m, "Enter") === "advance");
  check("the right arrow advances", actionForKey(m, "ArrowRight") === "advance");
  check("Anki's own 1-4 still grade", actionForKey(m, "1") === "again" && actionForKey(m, "4") === "easy");
  check("an unbound key means nothing", actionForKey(m, "q") === null);

  // Case: a remote sending a shifted or capitalised letter must still match.
  check("case doesn't matter", actionForKey(m, "S") === "star", "some remotes send shifted keys");
  check("nor does it for named keys", actionForKey(m, "PAGEDOWN") === "advance");
  check("normalizeKey lowercases", normalizeKey("PageDown") === "pagedown");
}

// ---------- the 8BitDo, which is why this exists ----------
console.log("\nthe 8BitDo Zero 2 in keyboard mode:");
{
  // Its buttons send letters with no relation to their labels:
  // Up=C Down=D Left=E Right=F A=G X=H Y=I B=J L=K R=M Select=N Start=O
  const preset = REMOTE_PRESETS.find((p) => p.id === "8bitdo")!;
  const m = preset.mapping;
  check("R (m) advances", actionForKey(m, "m") === "advance");
  check("A (g) is Good", ["advance", "good"].includes(actionForKey(m, "g") ?? ""));
  check("B (j) is Again", ["fail", "again"].includes(actionForKey(m, "j") ?? ""));
  check("Y (i) is Hard", actionForKey(m, "i") === "hard");
  check("X (h) is Easy", actionForKey(m, "h") === "easy");
  check("L (k) undoes", actionForKey(m, "k") === "undo");
  check("the d-pad scrolls", actionForKey(m, "c") === "scrollUp" && actionForKey(m, "d") === "scrollDown");
  check(
    "and Space still works alongside it",
    actionForKey(m, " ") === "advance",
    "so the keyboard doesn't stop working when the remote is paired"
  );
}

// ---------- every preset is usable ----------
console.log("\nevery preset:");
for (const preset of REMOTE_PRESETS) {
  const m = preset.mapping;
  check(`"${preset.name}" can reveal a card`, (m.keys.advance ?? []).length > 0);
  const grades = ["again", "hard", "good", "easy"] as const;
  check(
    `"${preset.name}" can grade`,
    grades.every((g) => (m.keys[g] ?? []).length > 0) ||
      ((m.keys.advance ?? []).length > 0 && (m.keys.fail ?? []).length > 0),
    "either all four grades, or at least advance and fail"
  );
  // The same key meaning two things would make the remote unpredictable.
  const seen = new Map<string, string>();
  let clash = "";
  for (const { id } of REMOTE_ACTIONS) {
    for (const k of m.keys[id] ?? []) {
      // advance/good and fail/again deliberately overlap: which one applies
      // depends on whether the answer is showing.
      const pair = new Set([seen.get(k), id]);
      const allowed =
        (pair.has("advance") && pair.has("good")) ||
        (pair.has("fail") && pair.has("again"));
      if (seen.has(k) && !allowed) clash = `${k}: ${seen.get(k)} and ${id}`;
      seen.set(k, id);
    }
  }
  check(`"${preset.name}" has no accidental double-binding`, clash === "", clash);
}

// ---------- gamepads ----------
console.log("\ncontrollers:");
{
  const m = DEFAULT_MAPPING;
  check("the bottom face button advances", actionForButton(m, 0) === "advance");
  check("the right one fails", actionForButton(m, 1) === "fail");
  check("a shoulder undoes", actionForButton(m, 4) === "undo");
  check("an unmapped button does nothing", actionForButton(m, 7) === null);
  check("buttons are named for people", buttonLabel(0).includes("A"));
  check("even unknown ones", buttonLabel(11) === "Button 11");
}

// ---------- the one that would ruin a session ----------
console.log("\na held button:");
{
  const up = [false, false, false];
  const down = [true, false, false];
  check("a fresh press registers", pressedSince(up, down).join() === "0");
  check(
    "holding it does not repeat",
    pressedSince(down, down).length === 0,
    "otherwise a resting thumb grades the whole deck at 60 a second"
  );
  check("releasing does nothing", pressedSince(down, up).length === 0);
  check("and pressing again does", pressedSince(up, down).join() === "0");
  check(
    "two at once are both seen",
    pressedSince([false, false, false], [true, true, false]).join() === "0,1"
  );
  check(
    "a controller with more buttons than last poll is safe",
    pressedSince([], [true, true]).join() === "0,1",
    "the first poll has no previous state to compare against"
  );
}

// ---------- rebinding ----------
console.log("\nrebinding:");
{
  let m: RemoteMapping = DEFAULT_MAPPING;
  m = bindKey(m, "easy", "PageDown");
  check("a key moves to its new action", actionForKey(m, "PageDown") === "easy");
  check(
    "and leaves the old one",
    !(m.keys.advance ?? []).includes("pagedown"),
    "one key, one meaning"
  );
  check("the rest of advance survives", (m.keys.advance ?? []).includes(" "));

  m = bindButton(m, "star", 0);
  check("a button moves too", actionForButton(m, 0) === "star");
  check("off its old action", !(m.buttons.advance ?? []).includes(0));

  m = clearAction(m, "star");
  check("clearing empties both halves", (m.keys.star ?? []).length === 0 && (m.buttons.star ?? []).length === 0);
  check("without touching anything else", actionForKey(m, " ") === "advance");

  // Binding the same key twice to one action shouldn't duplicate it.
  let n: RemoteMapping = bindKey(DEFAULT_MAPPING, "easy", "p");
  n = bindKey(n, "easy", "p");
  check("binding twice doesn't duplicate", (n.keys.easy ?? []).filter((k) => k === "p").length === 1);
}

// ---------- labels ----------
console.log("\nreadable labels:");
{
  check("space is spelled out", keyLabel(" ") === "Space");
  check("arrows are arrows", keyLabel("arrowright") === "→");
  check("page keys read properly", keyLabel("pagedown") === "Page Down");
  check("letters are capitalised", keyLabel("g") === "G");
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
