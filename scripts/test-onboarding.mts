// What a new account is told, checked against the source.
//
// The welcome screen is the one page where someone decides whether this app is
// worth their evening, and the thing most of them want — bringing their Anki
// deck over — used to be buried in a "More" menu on another page. So these
// cases hold three properties in place: importing is offered on arrival, the
// deep link that opens the importer agrees with the code that reads it, and
// there are actual instructions rather than two unexplained buttons.
//
// The link/parser agreement is the one worth having a machine check. A typo in
// either half fails silently — the page just loads with no modal — and it is
// exactly the sort of thing that survives a casual click-through because the
// menu item still works.
import { readFileSync } from "node:fs";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const home = readFileSync("src/pages/HomePage.tsx", "utf8");
const dash = readFileSync("src/pages/Dashboard.tsx", "utf8");

console.log("the welcome screen offers the Anki import:");
{
  check(
    "it names importing from Anki",
    /Import from Anki/.test(home),
    "most people arrive with an .apkg already"
  );
  check(
    "and says which file types work",
    /\.apkg/.test(home) && /colpkg/.test(home),
    "so nobody has to guess what to export"
  );
  check(
    "it still offers making a deck",
    /Create a deck/.test(home)
  );
  check("and taking notes", /Take notes/.test(home));
}

console.log("\nthe deep link and the code that reads it agree:");
{
  // Both halves are extracted rather than hard-coded, so this compares the
  // app against itself instead of against this file's idea of the answer.
  const linked = home.match(/to="\/decks\?([a-zA-Z]+)=([a-zA-Z]+)"/);
  check("the welcome tile links to /decks with a query", Boolean(linked));

  const key = linked?.[1];
  const value = linked?.[2];
  check(
    "the Dashboard reads that same parameter",
    Boolean(key) && dash.includes(`searchParams.get("${key}")`),
    `link sends ?${key}=…`
  );
  check(
    "and compares it to that same value",
    Boolean(value) && new RegExp(`searchParams\\.get\\("${key}"\\)\\s*!==\\s*"${value}"`).test(dash),
    `link sends ${key}=${value}`
  );
  check(
    "the parameter is cleared once used",
    /next\.delete\("import"\)/.test(dash),
    "or closing the modal reopens it, and so does Back"
  );
  check(
    "opening it actually shows the importer",
    /setShowImport\(true\)/.test(dash) && /ImportAnkiModal/.test(dash)
  );
}

console.log("\nthe import is findable from more than one place:");
{
  const spots = [
    ["the welcome screen", /Import from Anki/.test(home)],
    ["the empty deck list", /Import from Anki/.test(dash)],
    ["the More menu", /MenuItem[\s\S]{0,120}Import from Anki/.test(dash)],
  ] as const;
  for (const [where, ok] of spots) {
    check(`offered on ${where}`, ok);
  }
  check(
    "and it is called the same thing everywhere",
    !/Import Anki file/.test(dash + home),
    "two names for one feature is how people fail to find it"
  );
}

console.log("\nthere are directions, not just buttons:");
{
  check(
    "the welcome screen explains how the app works",
    /How Recallis works/.test(home)
  );
  // Four numbered steps: cards in, study what's due, mask a slide, drill.
  const steps = home.match(/<Step n=\{\d\}/g) ?? [];
  check(
    "in numbered steps",
    steps.length >= 4,
    `${steps.length} found`
  );
  check(
    "the steps are numbered from 1 with no gaps",
    (home.match(/<Step n=\{(\d)\}/g) ?? [])
      .map((s) => Number(s.match(/\d/)![0]))
      .every((n, i) => n === i + 1)
  );
  for (const topic of [
    ["image occlusion", /[Mm]ask a slide/],
    ["the scheduler", /FSRS/],
    ["repeat mode", /Repeat mode/],
    ["the planner", /planner/],
  ] as const) {
    check(`it mentions ${topic[0]}`, topic[1].test(home));
  }
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
