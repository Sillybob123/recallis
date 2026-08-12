import {
  splitDeckPath, joinDeckPath, normalizeDeckPath, deckLeafName,
  buildDeckTree, collectDecks, findDeckByPath,
} from "../src/lib/deckPath";
import type { Deck } from "../src/types";

const mk = (name: string, id = name): Deck =>
  ({ id, name, color: "#000", createdAt: 0, updatedAt: 0 }) as Deck;

console.log("split '::':", splitDeckPath("Anatomy::Lab 3::Breast and Thorax"));
console.log("split legacy ' · ':", splitDeckPath("Anatomy · Lab00 · Positions"));
console.log("normalize legacy:", normalizeDeckPath("Anatomy · Lab00 · Positions"));
console.log("leaf:", deckLeafName("Anatomy::Lab 3::Vasculature"));
console.log("join:", joinDeckPath(["Anatomy", "", "Lab 3"]));

// Tree with an implicit parent (no "Anatomy" deck of its own)
const decks = [
  mk("Anatomy · Lab00 · Positions"),
  mk("Anatomy::Lab00::Tool Terms"),
  mk("Anatomy::Breast and Thorax"),
  mk("Practicing 1"),
];
const tree = buildDeckTree(decks);
function show(nodes: any[], indent = "") {
  for (const n of nodes) {
    console.log(`${indent}${n.name}${n.deck ? "" : "  (group only)"}  [${n.path}]`);
    show(n.children, indent + "  ");
  }
}
console.log("\ntree:");
show(tree);
const anatomy = tree.find((n) => n.name === "Anatomy")!;
console.log("\ndecks under Anatomy:", collectDecks(anatomy).map((d) => d.name));
console.log("findDeckByPath mixed separators:",
  findDeckByPath(decks, "anatomy::lab00::positions")?.name);

// ---------- what a browse of one deck has to load ----------
// Browsing used to pull every card in every deck before drawing a row.
// Loading one deck means loading its subtree, and only its subtree.
{
  const { deckSubtreeIds } = await import("../src/lib/deckPath");
  const decks = [
    { id: "a", name: "Anatomy", color: "", createdAt: 0, updatedAt: 0 },
    { id: "at", name: "Anatomy::Thorax", color: "", createdAt: 0, updatedAt: 0 },
    { id: "atl", name: "Anatomy::Thorax::Lungs", color: "", createdAt: 0, updatedAt: 0 },
    { id: "a2", name: "Anatomy 2", color: "", createdAt: 0, updatedAt: 0 },
    { id: "p", name: "Physiology", color: "", createdAt: 0, updatedAt: 0 },
  ];
  const ok = (name: string, cond: boolean, detail = "") =>
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

  console.log("\nloading one deck:");
  ok(
    "a parent brings its whole subtree",
    deckSubtreeIds(decks, ["a"]).sort().join() === "a,at,atl",
    deckSubtreeIds(decks, ["a"]).sort().join()
  );
  ok(
    "but not a deck that merely starts the same way",
    !deckSubtreeIds(decks, ["a"]).includes("a2"),
    "\"Anatomy 2\" is not inside \"Anatomy\""
  );
  ok("nor an unrelated one", !deckSubtreeIds(decks, ["a"]).includes("p"));
  ok("a leaf is just itself", deckSubtreeIds(decks, ["atl"]).join() === "atl");
  ok(
    "a middle deck takes what's under it",
    deckSubtreeIds(decks, ["at"]).sort().join() === "at,atl"
  );
  ok("several roots combine", deckSubtreeIds(decks, ["at", "p"]).sort().join() === "at,atl,p");
  ok("none means none", deckSubtreeIds(decks, []).length === 0, "an empty browse loads nothing");
  ok("an unknown id is harmless", deckSubtreeIds(decks, ["nope"]).length === 0);
}
