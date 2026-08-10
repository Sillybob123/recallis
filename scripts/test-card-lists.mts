// Bulleted and numbered lists arrive intact from Anki — 1,493 cards in the
// real collection contain them. What went missing was the markers: Tailwind's
// preflight strips list-style from every ul/ol, so a list rendered as
// indented plain lines. These check the CSS actually puts them back.
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";

const css = readFileSync("src/index.css", "utf8");

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("card list styling:");
const rule = (selector: string) =>
  new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*\\}`
  ).exec(css)?.[0] ?? "";

check(
  "bulleted lists get a marker",
  /list-style-type:\s*disc/.test(rule(".prose-card :where(ul)")),
  rule(".prose-card :where(ul)").replace(/\s+/g, " ")
);
check(
  "numbered lists get numbers",
  /list-style-type:\s*decimal/.test(rule(".prose-card :where(ol)")),
  rule(".prose-card :where(ol)").replace(/\s+/g, " ")
);
check(
  "nested bullets change shape",
  /list-style-type:\s*circle/.test(rule(".prose-card :where(ul ul)")) &&
    /list-style-type:\s*square/.test(rule(".prose-card :where(ul ul ul)"))
);
check(
  "nested numbering changes style",
  /lower-alpha/.test(rule(".prose-card :where(ol ol)")) &&
    /lower-roman/.test(rule(".prose-card :where(ol ol ol)"))
);
check(
  "list items are laid out as list items",
  /display:\s*list-item/.test(rule(".prose-card :where(li)"))
);
check(
  "there is room for the marker to sit in",
  /padding-left/.test(rule(".prose-card :where(ul, ol)"))
);

// The checklist note type deliberately has no markers, and its rule comes
// earlier in the file — so it needs the higher specificity to still win.
check(
  "checklists keep their markers hidden",
  /list-style:\s*none/.test(rule(".prose-card ul.checklist")),
  "and it out-specifies the generic ul rule, which appears later"
);
check(
  "the checklist rule is not wrapped in :where()",
  !css.includes(".prose-card :where(ul.checklist)"),
  ":where() is specificity 0, so source order would beat it"
);

// ---------- the markup itself survives sanitising ----------
console.log("\nmarkup survives the renderer:");
{
  const { document } = parseHTML("<html><body></body></html>");
  (globalThis as unknown as { document: Document }).document =
    document as unknown as Document;
  const { makeColorsReadable } = await import("../src/lib/readableColor");
  const { htmlToText } = await import("../src/lib/text");

  // Taken from a real card in the collection.
  const real =
    '<div style="text-align: left;">There are<b> three kinds</b> of nerve ' +
    "cells in the nervous systems.... what are they?</div>" +
    '<div style="text-align: left;"><ol><li>Sensory neurons</li>' +
    "<li>Motor neurons</li><li>Interneurons</li></ol></div>";

  check(
    "the colour pass leaves list tags alone",
    makeColorsReadable(real).includes("<ol><li>Sensory neurons</li>")
  );
  const text = htmlToText(real);
  check(
    "each list item becomes its own line in plain text",
    text.includes("Sensory neurons\nMotor neurons\nInterneurons"),
    JSON.stringify(text.slice(-60))
  );
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
