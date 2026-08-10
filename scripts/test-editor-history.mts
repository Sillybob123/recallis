// Ctrl+Z has to work, and work the way people expect: one press takes back a
// burst of typing, not a letter, and redo brings it back exactly.
import { parseHTML } from "linkedom";

const { document, window: win } = parseHTML("<html><body></body></html>");
const g = globalThis as unknown as Record<string, unknown>;
g.document = document;
// linkedom implements createTreeWalker but doesn't publish NodeFilter.
g.NodeFilter = win.NodeFilter ?? { SHOW_TEXT: 4 };

const { EditorHistory, locateOffset } = await import(
  "../src/lib/editorHistory"
);

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---------- stepping back and forward ----------
console.log("undo and redo:");
{
  const h = new EditorHistory({ html: "<p></p>", caret: 0 });
  check("nothing to undo at the start", !h.canUndo && !h.canRedo);

  h.push({ html: "<p>The heart</p>", caret: 9 });
  h.push({ html: "<p>The heart has four</p>", caret: 18 });
  check("two steps recorded", h.canUndo && !h.canRedo);

  const back = h.undo();
  check("undo returns the previous state", back?.html === "<p>The heart</p>");
  check("and redo becomes available", h.canRedo);

  const forward = h.redo();
  check("redo restores exactly what was undone",
    forward?.html === "<p>The heart has four</p>");
  check("redo runs out at the newest state", !h.canRedo);
}

// ---------- the accidental deletion ----------
console.log("\nthe case that matters:");
{
  const written = "<p>A long paragraph about the cardiac cycle…</p>";
  const h = new EditorHistory({ html: "<p></p>", caret: 0 });
  h.push({ html: written, caret: 40 });
  h.push({ html: "<p></p>", caret: 0 }); // select-all, delete
  check("the deletion is a step of its own", h.canUndo);
  check("one undo brings the paragraph back", h.undo()?.html === written);
}

// ---------- typing after an undo discards the redo branch ----------
console.log("\nediting after undo:");
{
  const h = new EditorHistory({ html: "a", caret: 1 });
  h.push({ html: "ab", caret: 2 });
  h.push({ html: "abc", caret: 3 });
  h.undo();
  check("redo is available after stepping back", h.canRedo);
  h.push({ html: "abX", caret: 3 });
  check("typing replaces what was undone", !h.canRedo);
  check("and undo still reaches the older state", h.undo()?.html === "ab");
}

// ---------- no-op changes ----------
console.log("\nnon-changes:");
{
  const h = new EditorHistory({ html: "same", caret: 0 });
  const added = h.push({ html: "same", caret: 3 });
  check("identical html is not a new step", added === false);
  check("but the caret is kept up to date", h.current.caret === 3,
    "so undo lands where you were working");
  check("and there is still nothing to undo", !h.canUndo);
}

// ---------- bounded memory ----------
console.log("\nbounds:");
{
  const h = new EditorHistory({ html: "0", caret: 0 });
  for (let i = 1; i <= 400; i++) h.push({ html: `step ${i}`, caret: 0 });
  check("history stops growing without limit", h.canUndo);
  let depth = 0;
  while (h.undo()) depth++;
  check(`old steps are dropped, ${depth} kept`, depth <= 150 && depth > 100);
  check("the newest state is never dropped", h.canRedo);
}
{
  // One enormous note must not evict itself.
  const big = "x".repeat(1_500_000);
  const h = new EditorHistory({ html: big + "1", caret: 0 });
  h.push({ html: big + "2", caret: 0 });
  h.push({ html: big + "3", caret: 0 });
  check("a huge document keeps at least one step back", h.canUndo);
  check("and undo still works on it", h.undo()?.html.endsWith("2") === true);
}

// ---------- the caret ----------
// The selection API itself needs a real browser; what is worth testing is the
// arithmetic that decides which text node an offset lands in, since that is
// what has to survive the document being rebuilt from an HTML string.
console.log("caret placement:");
{
  const host = document.createElement("div");
  host.innerHTML = "<p>Hello</p><p>world</p>";
  const el = host as unknown as HTMLElement;

  const start = locateOffset(el, 0);
  check("offset 0 lands at the start of the first text", start?.offset === 0);

  const mid = locateOffset(el, 3);
  check("an offset inside the first block stays there",
    mid?.node.nodeValue === "Hello" && mid?.offset === 3);

  const across = locateOffset(el, 8);
  check("an offset past the first block moves into the second",
    across?.node.nodeValue === "world" && across?.offset === 3,
    `got ${across?.node.nodeValue}:${across?.offset}`);

  const boundary = locateOffset(el, 5);
  check("the boundary between blocks resolves rather than falling through",
    boundary !== null && boundary.offset === 5);

  const end = locateOffset(el, 10);
  check("the very end of the text still resolves", end?.offset === 5);

  check("past the end returns nothing, so the caller can go to the end",
    locateOffset(el, 999) === null);
}
{
  const host = document.createElement("div");
  host.innerHTML = "<p>a<b>bc</b>d</p>";
  const el = host as unknown as HTMLElement;
  const inside = locateOffset(el, 2);
  check("nested formatting is walked through",
    inside?.node.nodeValue === "bc" && inside?.offset === 1,
    `got ${inside?.node.nodeValue}:${inside?.offset}`);
}
{
  const host = document.createElement("div");
  host.innerHTML = "";
  check("an empty editor has nowhere to put the caret",
    locateOffset(host as unknown as HTMLElement, 0) === null);
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
