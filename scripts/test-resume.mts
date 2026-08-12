// Coming back to a study run after editing a card.
//
// Editing an occlusion sheet leaves the session for its own page, so the
// way back has to be carried along and the rebuilt queue has to put you on
// the card you just changed. Getting it wrong either drops you on the deck
// page — the run over — or lands you on a different card, where you can't
// see whether the edit did what you wanted.
import type { StudyItem } from "../src/lib/studyItems";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// The function under test, kept identical to the one in StudyBasic.
function applyResume(
  items: StudyItem[],
  ref: { current: string | null }
): StudyItem[] {
  const key = ref.current;
  if (!key) return items;
  const at = items.findIndex((it) => it.key === key);
  if (at < 0) return items;
  ref.current = null;
  if (at === 0) return items;
  return [items[at], ...items.slice(0, at), ...items.slice(at + 1)];
}

const item = (key: string): StudyItem =>
  ({
    kind: "text",
    deckId: "d",
    key,
    cardId: key,
    frontHtml: key,
    backHtml: "",
    frontPlain: "",
    backPlain: "",
    isCloze: false,
  }) as StudyItem;

const queue = ["a", "b", "c", "d"].map(item);
const keys = (items: StudyItem[]) => items.map((i) => i.key).join(",");

console.log("landing on the card you edited:");
{
  const ref = { current: "c" };
  const out = applyResume(queue, ref);
  check("it comes to the front", out[0].key === "c");
  check(
    "and everything else keeps its order",
    keys(out) === "c,a,b,d",
    keys(out)
  );
  check("the marker is spent", ref.current === null, "so a later rebuild leaves it alone");
}

console.log("\nwhen there's nothing to do:");
{
  check("no marker, no change", keys(applyResume(queue, { current: null })) === "a,b,c,d");
  const already = { current: "a" };
  check(
    "already at the front, no change",
    keys(applyResume(queue, already)) === "a,b,c,d"
  );
  check("but still spent", already.current === null);

  // The card may have been deleted while you were editing, or the queue may
  // not have loaded yet.
  const missing = { current: "zzz" };
  check("an unknown card leaves the queue alone", keys(applyResume(queue, missing)) === "a,b,c,d");
  check(
    "and keeps the marker for the next build",
    missing.current === "zzz",
    "the data may simply not have arrived yet"
  );
  const empty = { current: "c" };
  check("an empty queue doesn't spend it", keys(applyResume([], empty)) === "" && empty.current === "c");
}

console.log("\napplied once, not on every rebuild:");
{
  // The queue is rebuilt when settings change or a card is edited. Rotating
  // every time would drag one card to the front for the rest of the run.
  const ref = { current: "d" };
  const first = applyResume(queue, ref);
  check("the first rebuild rotates", first[0].key === "d");
  const second = applyResume(queue, ref);
  check("the second doesn't", keys(second) === "a,b,c,d", keys(second));
}

console.log("\nthe way back:");
{
  // What openEditor builds, checked as a string so the shape of the URL is
  // pinned: the study page, its parameters, and the card to return to.
  const studyUrl = "/deck/d1/study";
  const search = "?format=learn";
  const back = new URL(studyUrl + search, "https://recallis.org");
  back.searchParams.set("resume", "sheet1-mask3");
  const href = `/deck/d1/occlusion/sheet1/edit?returnTo=${encodeURIComponent(
    back.pathname + back.search
  )}`;
  check("the editor is told where to return to", href.includes("returnTo="));
  const returnTo = decodeURIComponent(href.split("returnTo=")[1]);
  check("which is the study page", returnTo.startsWith("/deck/d1/study"), returnTo);
  check("with the run's own settings kept", returnTo.includes("format=learn"));
  check("and the card named", returnTo.includes("resume=sheet1-mask3"));
  check(
    "the label follows the destination",
    /\/study/.test(returnTo),
    'so it reads "Back to studying" rather than "Back to notes"'
  );
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
