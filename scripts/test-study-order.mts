// Cards made from a lecture are created slide by slide, so creation time is
// slide order. "In order" has to follow it exactly — including the several
// cards one note produces, which is the case shuffling deliberately breaks up.
import { buildTextItems, buildOcclusionItems } from "../src/lib/studyItems";
import { spreadSiblings } from "../src/lib/siblings";
import type { Card, OcclusionSheet } from "../src/types";
import { parseHTML } from "linkedom";

const { document } = parseHTML("<html><body></body></html>");
(globalThis as unknown as { document: Document }).document =
  document as unknown as Document;

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/** A card made while writing about a given slide. */
const card = (id: string, createdAt: number, front: string): Card & { deckId: string } =>
  ({
    id,
    deckId: "d1",
    createdAt,
    updatedAt: createdAt,
    stats: { correct: 0, incorrect: 0 },
    data: { type: "basic", front, back: "…" },
  }) as never;

const cloze = (id: string, createdAt: number, text: string): Card & { deckId: string } =>
  ({
    id,
    deckId: "d1",
    createdAt,
    updatedAt: createdAt,
    stats: { correct: 0, incorrect: 0 },
    data: { type: "cloze", text },
  }) as never;

// Written in the order the lecture was taught.
const cards = [
  card("c1", 1000, "slide 1 — first point"),
  card("c2", 2000, "slide 1 — second point"),
  cloze("c3", 3000, "slide 2 has {{c1::this}} and {{c2::that}}"),
  card("c4", 4000, "slide 3 — a point"),
];
const sheets: (OcclusionSheet & { deckId: string })[] = [
  {
    id: "s1",
    deckId: "d1",
    createdAt: 3500,
    updatedAt: 3500,
    title: "slide 2 diagram",
    imagePath: "p",
    imageUrl: "u",
    imageWidth: 100,
    imageHeight: 100,
    shapes: [
      { id: "a", kind: "rect", x: 0, y: 0, w: 0.1, h: 0.1 },
      { id: "b", kind: "rect", x: 0.2, y: 0, w: 0.1, h: 0.1 },
    ],
  } as never,
];

const createdAtOf = new Map<string, number>();
for (const c of cards) createdAtOf.set(`${c.deckId}|${c.id}`, c.createdAt);
for (const sh of sheets) createdAtOf.set(`${sh.deckId}|${sh.id}`, sh.createdAt);

type Item = ReturnType<typeof buildTextItems>[number];
const itemOrder = (it: Item) =>
  createdAtOf.get(
    it.kind === "text" ? `${it.deckId}|${it.cardId}` : `${it.deckId}|${it.sheet.id}`
  ) ?? 0;

const pool = [...buildTextItems(cards), ...buildOcclusionItems(sheets)];
const ordered = [...pool].sort((a, b) => itemOrder(a) - itemOrder(b));
const keys = ordered.map((i) => i.key);

console.log("in order:");
console.log(`      ${keys.join(" ")}`);
check(
  "everything is present",
  ordered.length === pool.length && new Set(keys).size === keys.length,
  `${ordered.length} items`
);
check(
  "creation order is followed",
  ordered.every((it, i) => i === 0 || itemOrder(ordered[i - 1]) <= itemOrder(it)),
  "so slide 1 comes before slide 2"
);
check("the first slide's cards lead", keys[0] === "c1" && keys[1] === "c2");
check(
  "a note's blanks stay together and in number order",
  keys.indexOf("c3-c1") + 1 === keys.indexOf("c3-c2"),
  `${keys.indexOf("c3-c1")} then ${keys.indexOf("c3-c2")}`
);
check(
  "an occlusion sheet lands where it was made",
  keys.indexOf("s1-a") > keys.indexOf("c3-c2") &&
    keys.indexOf("s1-a") < keys.indexOf("c4"),
  "between slide 2's cloze and slide 3"
);
check("the last card is last", keys[keys.length - 1] === "c4");

console.log("\nshuffle, for contrast:");
{
  // The shuffled build deliberately pushes a note's blanks apart.
  const spread = spreadSiblings([...pool], 10);
  const sk = spread.map((i) => i.key);
  check(
    "everything is still present",
    spread.length === pool.length && new Set(sk).size === sk.length
  );
  check(
    "a note's blanks are pushed apart",
    Math.abs(sk.indexOf("c3-c1") - sk.indexOf("c3-c2")) > 1,
    `${sk.indexOf("c3-c1")} and ${sk.indexOf("c3-c2")} — which ordered mode must not do`
  );
}

console.log("\nawkward data:");
{
  // Cards imported in bulk can share a timestamp; a stable result still matters.
  const same = [
    card("x1", 500, "a"),
    card("x2", 500, "b"),
    card("x3", 500, "c"),
  ];
  const m = new Map(same.map((c) => [`${c.deckId}|${c.id}`, c.createdAt]));
  const items = buildTextItems(same);
  const out = [...items].sort(
    (a, b) =>
      (m.get(`${a.deckId}|${a.cardId}`) ?? 0) - (m.get(`${b.deckId}|${b.cardId}`) ?? 0)
  );
  check(
    "identical timestamps keep their existing order",
    out.map((i) => i.key).join(",") === "x1,x2,x3",
    out.map((i) => i.key).join(",")
  );
}
{
  const unknown = buildTextItems([card("y1", 0, "no timestamp")]);
  check("a missing timestamp sorts first rather than crashing",
    (createdAtOf.get(`d1|y1`) ?? 0) === 0 && unknown.length === 1);
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
