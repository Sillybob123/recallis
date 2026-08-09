// An occlusion sheet's masks are all siblings — same image, different mask.
// Seeing two in a row is the same picture twice, which is exactly the "it made
// me do it again right after" complaint.
import {
  disperseSiblings,
  spreadSiblings,
  MIN_SIBLING_GAP,
} from "../src/lib/siblings";
import type { StudyItem } from "../src/lib/studyItems";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/** A mask on a sheet, or a plain card. */
function mask(sheet: string, n: number): StudyItem {
  return {
    kind: "occlusion",
    deckId: "d1",
    key: `${sheet}-m${n}`,
    sheet: { id: sheet } as never,
    unit: { key: `m${n}`, shapeIds: [], label: `${sheet}${n}` } as never,
  };
}
function card(id: string): StudyItem {
  return {
    kind: "text",
    deckId: "d1",
    key: id,
    cardId: id,
    frontHtml: "",
    backHtml: "",
    backPlain: "",
    frontPlain: "",
    isCloze: false,
  };
}

const show = (q: StudyItem[]) => q.map((i) => i.key).join(" ");

/** Positions where two neighbours come from the same note. */
function backToBack(q: StudyItem[]): string[] {
  const bad: string[] = [];
  for (let i = 1; i < q.length; i++) {
    const a = q[i - 1];
    const b = q[i];
    const ga = a.kind === "occlusion" ? a.sheet.id : a.cardId;
    const gb = b.kind === "occlusion" ? b.sheet.id : b.cardId;
    if (ga === gb) bad.push(`${a.key} → ${b.key}`);
  }
  return bad;
}

// ---------- the reported case ----------
// Answering mask A1 of a five-mask sheet, with its siblings near the front.
console.log("after answering one mask of a sheet:");
{
  const queue = [
    mask("S", 2),
    mask("S", 3),
    mask("S", 4),
    card("c1"),
    card("c2"),
    card("c3"),
    card("c4"),
    card("c5"),
    card("c6"),
    card("c7"),
    mask("S", 1), // the one just answered, put back far away
  ];
  const out = disperseSiblings(queue, mask("S", 1), 10);
  console.log(`      ${show(out)}`);
  const bad = backToBack(out);
  check(
    "the sheet's other masks are not left back to back",
    bad.length === 0,
    bad.length ? bad.join(", ") : ""
  );
}

// ---------- a freshly built queue ----------
console.log("\nbuilding a session that is mostly one sheet:");
{
  const queue = [
    ...Array.from({ length: 6 }, (_, i) => mask("S", i + 1)),
    ...Array.from({ length: 6 }, (_, i) => card(`c${i}`)),
  ];
  const out = spreadSiblings(queue, 10);
  console.log(`      ${show(out)}`);
  const bad = backToBack(out);
  check("a fresh queue never opens with the same image twice", bad.length === 0,
    bad.length ? bad.join(", ") : "");
}

// ---------- dispersal must actually move things away ----------
console.log("\ndispersal:");
{
  const queue = [mask("S", 2), card("c1"), card("c2"), card("c3"), card("c4"), card("c5")];
  const out = disperseSiblings(queue, mask("S", 1), MIN_SIBLING_GAP);
  const pos = out.findIndex((i) => i.key === "S-m2");
  check(
    "a sibling at the front is pushed back",
    pos >= MIN_SIBLING_GAP - 1,
    `now at index ${pos}: ${show(out)}`
  );
}
{
  const queue = [card("c1"), card("c2"), mask("S", 2)];
  const same = disperseSiblings(queue, mask("T", 1), 10);
  check(
    "nothing to move returns the same array",
    same === queue,
    "callers rely on this to skip a re-render"
  );
}
{
  const queue = [mask("S", 2), mask("S", 3)];
  const out = disperseSiblings(queue, mask("S", 1), 10);
  check(
    "a queue that is all siblings still returns everything",
    out.length === 2 && new Set(out.map((i) => i.key)).size === 2,
    show(out)
  );
}

// ---------- no card may be lost or duplicated ----------
console.log("\nintegrity:");
{
  const queue = [
    mask("S", 2), mask("S", 3), mask("S", 4), mask("T", 1),
    card("c1"), card("c2"), mask("T", 2), card("c3"),
  ];
  const out = disperseSiblings(queue, mask("S", 1), 10);
  check(
    "every card survives dispersal exactly once",
    out.length === queue.length &&
      new Set(out.map((i) => i.key)).size === queue.length,
    show(out)
  );
}

// ---------- the reported sequence, end to end ----------
// Miss a mask, get it right on the retry, and it must not come straight back.
console.log("\nmiss → retry → correct:");
{
  const MASTERY = 2;
  const MAX_EXTRA_REPS = 2;
  const RETRY_GAP = 3;
  const SPACED_GAP = 12;

  const strengths = new Map<string, number>();
  const misses = new Map<string, number>();
  const required = (k: string) =>
    MASTERY + Math.min(misses.get(k) ?? 0, MAX_EXTRA_REPS);

  function reinsert(prev: StudyItem[], item: StudyItem, at: number) {
    const rest = prev.slice(1);
    const pos = Math.min(at, rest.length);
    return [...rest.slice(0, pos), item, ...rest.slice(pos)];
  }
  /** markCram, followed by the sibling policy, exactly as the page does it. */
  function answer(queue: StudyItem[], correct: boolean): StudyItem[] {
    const current = queue[0];
    const key = current.key;
    const st = strengths.get(key) ?? 0;
    const missed = (misses.get(key) ?? 0) > 0;
    let next: StudyItem[];
    if (!correct) {
      misses.set(key, (misses.get(key) ?? 0) + 1);
      strengths.set(key, 0);
      next = reinsert(queue, current, RETRY_GAP);
    } else {
      const strength = st + (missed ? 1 : 2);
      strengths.set(key, strength);
      next =
        strength >= required(key)
          ? queue.slice(1)
          : reinsert(
              queue,
              current,
              missed ? Math.max(SPACED_GAP, queue.length - 2) : Math.max(8, queue.length - 2)
            );
    }
    return disperseSiblings(next, current, 10);
  }

  // A sheet of five masks among twenty other cards — a normal deck.
  let queue: StudyItem[] = spreadSiblings(
    [
      ...Array.from({ length: 5 }, (_, i) => mask("S", i + 1)),
      ...Array.from({ length: 20 }, (_, i) => card(`c${i}`)),
    ],
    10
  );
  // Bring the mask we care about to the front.
  const target = "S-m1";
  queue = [
    queue.find((i) => i.key === target)!,
    ...queue.filter((i) => i.key !== target),
  ];

  queue = answer(queue, false); // missed it
  const afterMiss = queue.findIndex((i) => i.key === target);
  check(
    "a missed mask comes back soon, but not immediately",
    afterMiss >= 2,
    `${afterMiss} cards away`
  );
  check(
    "and the card right after it is a different image",
    queue[0].key !== target && backToBack([queue[0], queue[1]]).length === 0
  );

  // Answer everything until it comes round again, then get it right.
  while (queue[0].key !== target) queue = answer(queue, true);
  queue = answer(queue, true);
  const afterCorrect = queue.findIndex((i) => i.key === target);
  check(
    "getting it right sends it far away, not next",
    afterCorrect >= 8,
    `${afterCorrect} cards away`
  );
  check(
    "it is still in the session — one correct answer does not clear a miss",
    afterCorrect !== -1 && required(target) === 3
  );
  console.log(`      queue now: ${show(queue)}`);
  const masksLeft = queue.filter((i) => i.kind === "occlusion").length;
  const bad = backToBack(queue);
  check("no two masks of the sheet are adjacent anywhere", bad.length === 0,
    `${masksLeft} masks among ${queue.length} cards` + (bad.length ? ` — ${bad.join(", ")}` : ""));
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
