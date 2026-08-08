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
