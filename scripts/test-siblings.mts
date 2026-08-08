// Checks that cloze siblings can't crowd each other in a session.
import { disperseSiblings, removeSiblings, siblingGroup, MIN_SIBLING_GAP } from "../src/lib/siblings";
import type { StudyItem } from "../src/lib/studyItems";

const mk = (cardId: string, cloze: number): StudyItem =>
  ({ kind: "text", deckId: "d1", cardId, key: `${cardId}-c${cloze}`,
     frontHtml: "", backHtml: "", backPlain: "", frontPlain: "", isCloze: true }) as StudyItem;

// A dense note: 5 clozes from one sentence, plus unrelated cards
const note = [1, 2, 3, 4, 5].map((n) => mk("noteA", n));
const others = Array.from({ length: 12 }, (_, i) => mk(`other${i}`, 1));
const keys = (q: StudyItem[]) => q.map((i) => i.key.replace("noteA-", "A-").replace(/other(\d+)-c1/, "o$1"));

console.log("group id shared by clozes of one note:",
  siblingGroup(note[0]) === siblingGroup(note[1]));

// Worst case: all five clozes sit at the front of the queue
let queue = [...note, ...others];
console.log("\nbefore:", keys(queue).join(" "));
const answered = queue[0];
queue = queue.slice(1);                       // answered card retired
queue = disperseSiblings(queue, answered, 10);
console.log("after answering A-c1 (gap 10):");
console.log("  ", keys(queue).join(" "));
const firstSibling = queue.findIndex((i) => i.key.startsWith("noteA"));
console.log("   first sibling now at position:", firstSibling, "(want >= 10)");

// Answer the next card, then its siblings should move again
const answered2 = queue[0];
let q2 = disperseSiblings(queue.slice(1), answered2, 10);
console.log("\nafter answering the next card:", keys(q2).slice(0, 14).join(" "));

// "off" still enforces a hard floor
let q3 = disperseSiblings([...note.slice(1), ...others], note[0], 0);
const gapOff = q3.findIndex((i) => i.key.startsWith("noteA"));
console.log("\nmode 'off' floor:", gapOff, `(want >= ${MIN_SIBLING_GAP})`);

// Bury removes them from the session entirely
const { queue: buried, removed } = removeSiblings([...note.slice(1), ...others], note[0]);
console.log("bury: removed", removed.length, "siblings, queue now", buried.length,
  "| any siblings left?", buried.some((i) => i.key.startsWith("noteA")));

// A short queue must not break
console.log("\nshort queue (2 cards):", keys(disperseSiblings([note[1], note[2]], note[0], 10)).join(" "));

// --- queue build: a dense multi-cloze note must not open the session ---
import { spreadSiblings } from "../src/lib/siblings";
{
  const dense = [
    ...[1,2,3,4,5,6,7,8,9].map((n) => mk("nerve", n)),   // 9-cloze note
    ...[1,2,3].map((n) => mk("muscle", n)),
    ...Array.from({ length: 8 }, (_, i) => mk(`solo${i}`, 1)),
  ];
  const spread = spreadSiblings(dense, 10);
  const label = (i: StudyItem) => i.key.replace(/-c(\d)/, "$1").replace("nerve", "N").replace("muscle", "M").replace(/solo(\d)1/, "s$1");
  console.log("\nbuilt queue (9-cloze + 3-cloze + 8 singles):");
  console.log("  ", spread.map(label).join(" "));

  // smallest gap actually achieved between two cards of the same note
  let worst = Infinity;
  const seen = new Map<string, number>();
  spread.forEach((item, i) => {
    const g = siblingGroup(item);
    if (seen.has(g)) worst = Math.min(worst, i - seen.get(g)!);
    seen.set(g, i);
  });
  console.log("   closest two siblings end up:", worst, "cards apart");
  console.log("   nothing lost:", spread.length === dense.length);
}

// Realistic session: 60 cards, a few multi-cloze notes mixed in
{
  const realistic = [
    ...[1,2,3,4,5,6,7,8,9].map((n) => mk("nerve", n)),
    ...[1,2,3,4].map((n) => mk("muscle", n)),
    ...[1,2].map((n) => mk("artery", n)),
    ...Array.from({ length: 45 }, (_, i) => mk(`solo${i}`, 1)),
  ];
  const spread = spreadSiblings(realistic, 10);
  let worst = Infinity;
  const seen = new Map<string, number>();
  spread.forEach((item, i) => {
    const g = siblingGroup(item);
    if (seen.has(g)) worst = Math.min(worst, i - seen.get(g)!);
    seen.set(g, i);
  });
  console.log(`\nrealistic 60-card session: closest siblings ${worst} apart (target 10), ` +
    `${spread.length} cards preserved`);
}
