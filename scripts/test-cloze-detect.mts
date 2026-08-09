// A note carrying {{c1::...}} is a cloze note, whatever its note type is
// called. Deciding from the name alone turned "Basic-000c0" notes into basic
// cards showing literal cloze braces on the front.
import { normalizeCardData, hasClozeMarkup } from "../src/lib/cloze";
import type { CardData } from "../src/types";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// The reported card, exactly as it was stored.
const reported: CardData = {
  type: "basic",
  front:
    "On which day(s) following fertilization does implantation occur?<br>{{c1::6-10}}",
  back:
    '"sticks at day 6 (to 10)"<br>Day 0: Fertilization<br>Day 1: Zygote<br>' +
    "Day 4: Morula<br>Day 5: Blastocyst<br>Day 6-10: Implantation",
};
{
  const fixed = normalizeCardData(reported);
  check("the reported card becomes a cloze", fixed.type === "cloze");
  if (fixed.type === "cloze") {
    check("its text is the front field", fixed.text === reported.front);
    check("its extra is the back field", fixed.extra === reported.back);
  }
}

// Ordinary basic cards must not be disturbed.
{
  const basic: CardData = { type: "basic", front: "Femur", back: "Thigh bone" };
  check("a real basic card is untouched", normalizeCardData(basic) === basic);
}
{
  const basic: CardData = {
    type: "basic",
    front: "What is a cloze?",
    back: "Anki writes them as {{c1::this}}",
  };
  check(
    "markup only in the back leaves it basic",
    normalizeCardData(basic) === basic,
    "front is what gets asked"
  );
}

// Existing cloze cards pass straight through.
{
  const cloze: CardData = { type: "cloze", text: "The {{c1::femur}}", extra: "x" };
  check("a cloze card is returned as-is", normalizeCardData(cloze) === cloze);
}

// A basic card with an empty back still converts.
{
  const fixed = normalizeCardData({
    type: "basic",
    front: "Implantation: {{c1::day 6-10}}",
    back: "",
  });
  check(
    "empty back becomes no extra",
    fixed.type === "cloze" && fixed.extra === undefined
  );
}

check("hasClozeMarkup finds {{c12::x}}", hasClozeMarkup("a {{c12::b}} c"));
check("hasClozeMarkup ignores {{Field}}", !hasClozeMarkup("{{Front}} {{Tags}}"));
check("hasClozeMarkup ignores bare braces", !hasClozeMarkup("f(x) = {x : x > 0}"));

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
