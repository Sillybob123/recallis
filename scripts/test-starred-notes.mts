// The Starred tab is the pre-exam view: everything flagged, in one list. It
// has to find inline highlights inside real note HTML, and it has to keep the
// two kinds of flag — a whole slide, a phrase — distinguishable.
import { parseHTML } from "linkedom";

const { document } = parseHTML("<html><body></body></html>");
(globalThis as unknown as { document: Document }).document =
  document as unknown as Document;

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/** The collector, exactly as the page runs it. */
function marksIn(html: string): string[] {
  return [...html.matchAll(/<mark class="starred">([\s\S]*?)<\/mark>/g)]
    .map((m) => m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

console.log("finding highlighted phrases:");
{
  const html =
    "<p>The cardiac cycle has two phases: " +
    '<mark class="starred">systole</mark> and ' +
    '<mark class="starred">diastole</mark>.</p>';
  const found = marksIn(html);
  check("every highlight is found", found.length === 2, found.join(", "));
  check("in the order they appear", found[0] === "systole" && found[1] === "diastole");
}
{
  // Highlights routinely contain formatting, since you bold then star.
  const html = '<mark class="starred">the <b>SA node</b> fires first</mark>';
  check(
    "formatting inside a highlight is stripped for the list",
    marksIn(html)[0] === "the SA node fires first",
    marksIn(html)[0]
  );
}
{
  const html = '<mark class="starred">line one<br>line two</mark>';
  check(
    "a highlight spanning a line break reads as one phrase",
    marksIn(html)[0] === "line one line two",
    marksIn(html)[0]
  );
}
{
  const html =
    '<p>a</p><mark class="starred">first</mark><p>b</p><mark class="starred">second</mark>';
  check("highlights separated by other content are all found",
    marksIn(html).length === 2);
}

console.log("\nwhat must not be collected:");
{
  check("plain marks are not highlights", marksIn("<mark>just yellow</mark>").length === 0,
    "the editor's own highlighter is a different thing");
  check("an empty highlight is skipped",
    marksIn('<mark class="starred"></mark>').length === 0);
  check("a whitespace-only highlight is skipped",
    marksIn('<mark class="starred">  <br> </mark>').length === 0);
  check("unstarred text contributes nothing", marksIn("<p>ordinary notes</p>").length === 0);
  check("empty html is safe", marksIn("").length === 0);
}

console.log("\nthe assembled list:");
{
  interface Slide { id: string; note: string; important?: boolean }
  const content = '<p>intro <mark class="starred">key idea</mark></p>';
  const slides: Slide[] = [
    { id: "s1", note: "<p>nothing special</p>" },
    { id: "s2", note: '<p>see <mark class="starred">Frank-Starling</mark></p>' },
    { id: "s3", note: "<p>whole slide matters</p>", important: true },
    { id: "s4", note: "", important: true },
  ];

  const out: { text: string; slide: number | null; whole: boolean }[] = [];
  for (const text of marksIn(content)) out.push({ text, slide: null, whole: false });
  slides.forEach((slide, i) => {
    if (slide.important) {
      const first = slide.note.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      out.push({ text: first || "(no notes yet)", slide: i, whole: true });
    }
    for (const text of marksIn(slide.note)) {
      out.push({ text, slide: i, whole: false });
    }
  });

  check("lecture-note highlights come first", out[0]?.slide === null,
    "they're the top of the document");
  check("a flagged slide is listed", out.some((o) => o.whole && o.slide === 2));
  check("a slide highlight is listed against its slide",
    out.some((o) => !o.whole && o.slide === 1 && o.text === "Frank-Starling"));
  check("a flagged slide with no notes still appears",
    out.some((o) => o.whole && o.slide === 3 && o.text === "(no notes yet)"),
    "or you'd flag it and never see it again");
  check("slides with nothing flagged are absent",
    !out.some((o) => o.slide === 0));
  check("four entries in total", out.length === 4, `${out.length}`);
  check("whole-slide and phrase flags stay distinguishable",
    out.filter((o) => o.whole).length === 2 &&
      out.filter((o) => !o.whole).length === 2);
}

console.log("\nthe highlight survives sanitising:");
{
  const { makeColorsReadable } = await import("../src/lib/readableColor");
  const html = '<p>a <mark class="starred">flagged phrase</mark> here</p>';
  check(
    "the colour pass leaves the marker class alone",
    makeColorsReadable(html).includes('<mark class="starred">'),
    "or flags would vanish when a card renders"
  );
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
