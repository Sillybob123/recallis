// Text that has to stay inside its box. A label spilling over the edge
// covers the anatomy underneath, which is the one thing a label on an
// anatomy plate must never do.
import { fitText, wrapText, type MeasureText } from "../src/lib/fitText";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// A stand-in for a font: every glyph half an em wide. Proportional fonts
// aren't this tidy, but the algorithm doesn't care and the arithmetic stays
// checkable by hand.
const measure: MeasureText = (text, size) => text.length * size * 0.5;

const fitsInside = (
  fit: ReturnType<typeof fitText>,
  w: number,
  h: number,
  padding = 4
) => {
  const innerW = w - padding * 2;
  const innerH = h - padding * 2;
  const widest = Math.max(...fit.lines.map((l) => measure(l, fit.fontSize)), 0);
  return widest <= innerW + 1e-6 && fit.lines.length * fit.fontSize * fit.lineHeight <= innerH + 1e-6;
};

// ---------- wrapping ----------
console.log("wrapping:");
{
  // 100px wide at 10px type = 20 characters a line.
  const lines = wrapText("the quick brown fox jumps over the lazy dog", 100, 10, measure);
  check("it breaks into lines", lines.length > 1, `${lines.length} lines`);
  check(
    "and no line is too wide",
    lines.every((l) => measure(l, 10) <= 100),
    lines.join(" | ")
  );
  check("no word is lost", lines.join(" ") === "the quick brown fox jumps over the lazy dog");

  check(
    "a short label stays on one line",
    wrapText("Aorta", 100, 10, measure).length === 1
  );
  check(
    "explicit line breaks are kept",
    wrapText("one\ntwo", 500, 10, measure).join("|") === "one|two"
  );

  // A long unbroken word is the case that breaks naive wrapping.
  const long = wrapText("sternocleidomastoideus", 50, 10, measure);
  check("a word wider than the line is split", long.length > 1, long.join("|"));
  check(
    "and every piece of it fits",
    long.every((l) => measure(l, 10) <= 50),
    long.join("|")
  );
  check("with nothing dropped", long.join("") === "sternocleidomastoideus");
}

// ---------- fitting ----------
console.log("\nfitting to the box:");
{
  // 200x70 leaves 52 of height after padding, and a 44px line at 1.2 needs
  // 52.8 — so the box has to be a little taller than that to reach the cap.
  const short = fitText("Aorta", 200, 70, measure);
  check("a short label gets the full size", short.fontSize === 44, `${short.fontSize}`);
  check("on one line", short.lines.length === 1);
  check("and it fits", fitsInside(short, 200, 70));
  check("with nothing overflowing", !short.overflow);

  const snug = fitText("Aorta", 200, 60, measure);
  check(
    "a box one line-height too short backs off rather than spilling",
    snug.fontSize < 44 && fitsInside(snug, 200, 60),
    `${snug.fontSize.toFixed(1)}px`
  );

  const long = fitText(
    "The recurrent laryngeal nerve hooks under the aortic arch on the left and under the subclavian artery on the right",
    200,
    60,
    measure
  );
  check("a long note shrinks", long.fontSize < 44, `${long.fontSize.toFixed(1)}px`);
  check("wraps onto several lines", long.lines.length > 2, `${long.lines.length}`);
  check("and still fits inside", fitsInside(long, 200, 60), "the whole point");

  // The same text in a bigger box should not be smaller.
  const roomier = fitText(
    "The recurrent laryngeal nerve hooks under the aortic arch on the left and under the subclavian artery on the right",
    400,
    120,
    measure
  );
  check(
    "more room means bigger type",
    roomier.fontSize > long.fontSize,
    `${long.fontSize.toFixed(1)} → ${roomier.fontSize.toFixed(1)}`
  );
  check("and it still fits", fitsInside(roomier, 400, 120));

  // Growing a box must never shrink the text, at any size.
  let previous = 0;
  let monotonic = true;
  for (const w of [60, 90, 120, 200, 320, 500]) {
    const f = fitText("Left coronary artery and its branches", w, 80, measure);
    if (f.fontSize < previous - 1e-9) monotonic = false;
    previous = f.fontSize;
  }
  check("widening never shrinks the text", monotonic, "no surprises while dragging a handle");
}

// ---------- the awkward cases ----------
console.log("\nthe awkward ones:");
{
  const tiny = fitText(
    "A very long explanation that could not possibly fit in a box this small no matter how far the type is shrunk down",
    40,
    20,
    measure
  );
  check("an impossible box still returns something", tiny.lines.length > 0);
  check("at the floor size", tiny.fontSize === 7, `${tiny.fontSize}`);
  check("and says so", tiny.overflow, "so the editor can warn rather than silently clip");

  const empty = fitText("   ", 100, 40, measure);
  check("empty text yields no lines", empty.lines.length === 0);
  check("and doesn't claim to overflow", !empty.overflow);

  const zero = fitText("Hello", 0, 0, measure);
  check("a zero-sized box doesn't hang or throw", zero.lines.length > 0, `${zero.fontSize}px`);

  const oneWord = fitText("Aorta", 200, 8, measure);
  check(
    "a box too short for one line still fits the width",
    Math.max(...oneWord.lines.map((l) => measure(l, oneWord.fontSize))) <= 192
  );
}

// ---------- cost ----------
console.log("\ncost:");
{
  let calls = 0;
  const counted: MeasureText = (t, s) => {
    calls++;
    return measure(t, s);
  };
  fitText("Aorta", 300, 80, counted);
  const forShort = calls;
  check("a label that already fits is measured once over", forShort < 15, `${forShort} measurements`);

  calls = 0;
  fitText(
    "The recurrent laryngeal nerve hooks under the aortic arch on the left and under the subclavian artery on the right, which is why a goitre can change the voice",
    160,
    70,
    counted
  );
  check(
    "and bisection keeps the long case bounded",
    calls < 400,
    `${calls} measurements — stepping a pixel at a time would be several times this`
  );
}

// ---------- every piece of text in a box goes through this ----------
// The failure this guards against is a second, hand-rolled shrink loop
// appearing somewhere — which is what the on-mask prompt had, with a
// different font and no way to break a long word, so a question could wrap
// differently in an exported Anki card than it did on screen.
console.log("\nnothing draws text its own way:");
{
  const { readFileSync } = await import("node:fs");
  const files = [
    "src/components/NoteBox.tsx",
    "src/components/ShapeOverlay.tsx",
    "src/pages/OcclusionEditor.tsx",
    "src/lib/shapes.ts",
    "src/lib/ankiExport.ts",
  ];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const drawsText =
      /fontSize|ctx\.font|fillText/.test(src) && !file.endsWith("fitText.ts");
    if (!drawsText) continue;
    check(`${file.split("/").pop()} uses the shared fitter`, src.includes("fitText"));
    // The specific thing that was there before: a loop stepping the size
    // down until the text happened to fit. Two of those in a codebase means
    // two answers to the same question, and they drift.
    check(
      `${file.split("/").pop()} has no shrink loop of its own`,
      !/for\s*\([^)]*size\s*=[^)]*size\s*-=/.test(src),
      "one fitter, or the screen and the export disagree"
    );
  }
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
