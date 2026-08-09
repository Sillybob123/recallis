// Block-level HTML must not collapse into run-on text — the Learn options
// showed "DirectionalityMedial is towards the midline" for a note whose card
// clearly has a heading and two lines.
import { parseHTML } from "linkedom";

const { document } = parseHTML("<html><body></body></html>");
(globalThis as unknown as { document: Document }).document = document as unknown as Document;

const { htmlToText, stripHtmlInline } = await import("../src/lib/text");

const cases: [string, string, string][] = [
  [
    "heading + two lines (the reported case)",
    "<div><b>Directionality</b></div><div>Medial is towards the midline</div><div>Lateral is away from the midline</div>",
    "Directionality\nMedial is towards the midline\nLateral is away from the midline",
  ],
  [
    "two sentences in sibling blocks",
    "<div>Congenital abnormalities are errors that lead to clinical disorders or morbidity.</div><div>Anatomical Variants are developmental errors that have zero or negligible symptoms.</div>",
    "Congenital abnormalities are errors that lead to clinical disorders or morbidity.\nAnatomical Variants are developmental errors that have zero or negligible symptoms.",
  ],
  [
    "explicit line breaks",
    "Dizygotic twins are formed from 2 separate oocyte fertilization events<br>Monozygotic twins are formed from 1 oocyte splitting",
    "Dizygotic twins are formed from 2 separate oocyte fertilization events\nMonozygotic twins are formed from 1 oocyte splitting",
  ],
  [
    "heading tags",
    "<h2>Suspensory ligaments</h2><p>Honeycomb-like sheets of connective tissue</p>",
    "Suspensory ligaments\nHoneycomb-like sheets of connective tissue",
  ],
  [
    "list items",
    "<ul><li>First</li><li>Second</li></ul>",
    "First\nSecond",
  ],
  [
    "inline markup stays on one line",
    "<div>The <b>medial</b> side is <i>towards</i> the midline</div>",
    "The medial side is towards the midline",
  ],
  [
    "entities are decoded",
    "<div>Cooper&#39;s ligaments &amp; the pectoral fascia</div>",
    "Cooper's ligaments & the pectoral fascia",
  ],
  [
    "nested blocks don't multiply blank lines",
    "<div><div><p>Only</p></div></div><div>Two</div>",
    "Only\nTwo",
  ],
  [
    "images contribute nothing but don't join words",
    "<div>Before</div><img src='x.png'><div>After</div>",
    "Before\nAfter",
  ],
  ["plain text is untouched", "Just a sentence", "Just a sentence"],
];

let failures = 0;
for (const [name, input, want] of cases) {
  const got = htmlToText(input);
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    console.log(`      want: ${JSON.stringify(want)}`);
    console.log(`      got:  ${JSON.stringify(got)}`);
  }
}

console.log(
  `\ninline preview: ${JSON.stringify(
    stripHtmlInline(
      "<div><b>Directionality</b></div><div>Medial is towards the midline</div>"
    )
  )}`
);
console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
