// Simulates the importer's dedupe: same package twice, then with new cards.
type CardData =
  | { type: "cloze"; text: string; extra?: string }
  | { type: "basic"; front: string; back: string };

function contentKey(data: CardData): string {
  const raw = data.type === "cloze" ? data.text : `${data.front}␟${data.back}`;
  return raw.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ").trim().toLowerCase();
}

interface Incoming { importId: string; data: CardData; due: string }
interface Stored { id: string; importId?: string; data: CardData; due: string }

const deck: Stored[] = [];
let nextId = 1;

function runImport(incoming: Incoming[]) {
  const index = new Map<string, string>();
  for (const c of deck) {
    if (c.importId) index.set(c.importId, c.id);
    index.set(`content:${contentKey(c.data)}`, c.id);
  }
  let added = 0, skipped = 0, rescheduled = 0;
  for (const inc of incoming) {
    const hit = index.get(inc.importId) ?? index.get(`content:${contentKey(inc.data)}`);
    if (hit) {
      skipped++;
      const card = deck.find((c) => c.id === hit)!;
      if (card.due !== inc.due) { card.due = inc.due; rescheduled++; }
      continue;
    }
    const id = `card${nextId++}`;
    deck.push({ id, importId: inc.importId, data: inc.data, due: inc.due });
    index.set(inc.importId, id);
    index.set(`content:${contentKey(inc.data)}`, id);
    added++;
  }
  return { added, skipped, rescheduled };
}

const pkg1: Incoming[] = [
  { importId: "anki:1", data: { type: "cloze", text: "The heart has {{c1::four}} chambers." }, due: "2026-08-10" },
  { importId: "anki:2", data: { type: "cloze", text: "{{c1::Transect}} - cut across." }, due: "2026-08-12" },
];
console.log("first import:      ", runImport(pkg1), "| deck size:", deck.length);
console.log("same package again:", runImport(pkg1), "| deck size:", deck.length);

// Anki side: 2 new cards added, and card 1's due date moved after review
const pkg2: Incoming[] = [
  { importId: "anki:1", data: pkg1[0].data, due: "2026-09-01" },
  { importId: "anki:2", data: pkg1[1].data, due: "2026-08-12" },
  { importId: "anki:3", data: { type: "cloze", text: "{{c1::Ligate}} - tie off." }, due: "2026-08-11" },
  { importId: "anki:4", data: { type: "basic", front: "Doyen retractor?", back: "Holds organs aside." }, due: "2026-08-14" },
];
console.log("updated package:   ", runImport(pkg2), "| deck size:", deck.length);
console.log("   card1 due is now:", deck[0].due, "(was 2026-08-10)");

// A card imported before importIds existed still matches on content
deck.push({ id: "legacy", data: { type: "cloze", text: "<b>{{c1::Excise}}</b> -  removal." }, due: "x" });
const pkg3: Incoming[] = [
  { importId: "anki:9", data: { type: "cloze", text: "{{c1::Excise}} - removal." }, due: "2026-08-20" },
];
console.log("legacy card:       ", runImport(pkg3), "| deck size:", deck.length);
console.log("   matched by content, due updated to:", deck.find((c) => c.id === "legacy")!.due);

// Confirm the parser emits stable import ids from a real package
import { readFileSync } from "node:fs";
import initSqlJs from "sql.js";
import { parseApkg } from "../src/lib/apkgParse";
const buf = readFileSync("example of decks/AnatomyApkcg.apkg");
const parsedPkg = await parseApkg(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  () => initSqlJs()
);
const ids = parsedPkg.decks.flatMap((d) => d.cards.map((c) => c.importId));
const sheetIds = parsedPkg.decks.flatMap((d) => d.sheets.map((sh) => sh.importId));
console.log(`\nreal package: ${ids.length} card ids, ${new Set(ids).size} unique`);
console.log("sample:", ids.slice(0, 2), "| sheets:", sheetIds.slice(0, 2));
console.log("all ids present:", ids.every(Boolean) && sheetIds.every(Boolean));
