import { readFileSync } from "node:fs";
import initSqlJs from "sql.js";
import { probeApkg, parseApkg } from "../src/lib/apkgParse";

const path = "example of decks/collection-2026-08-08@07-50-45.colpkg";
const buf = readFileSync(path);
const ab = () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

let t = performance.now();
const probe = await probeApkg(ab(), () => initSqlJs());
const probeMs = performance.now() - t;
console.log(`probe: ${probeMs.toFixed(0)}ms`);
console.log(`  ${probe.totalNotes} notes / ${probe.totalCards} cards`);
console.log(`  active: ${probe.activeNotes}, suspended: ${probe.suspendedNotes}`);
console.log(`  suspended cards: ${probe.suspendedCards}, scheduled: ${probe.scheduled}`);

t = performance.now();
const all = await parseApkg(ab(), () => initSqlJs());
const allMs = performance.now() - t;
const allCards = all.decks.reduce((n, d) => n + d.cards.length, 0);
const allSheets = all.decks.reduce((n, d) => n + d.sheets.length, 0);
console.log(`\nfull parse (all):        ${allMs.toFixed(0)}ms -> ${allCards} cards, ${allSheets} sheets`);

t = performance.now();
const active = await parseApkg(ab(), () => initSqlJs(), { excludeSuspended: true });
const activeMs = performance.now() - t;
const aCards = active.decks.reduce((n, d) => n + d.cards.length, 0);
const aSheets = active.decks.reduce((n, d) => n + d.sheets.length, 0);
console.log(`full parse (unsuspended): ${activeMs.toFixed(0)}ms -> ${aCards} cards, ${aSheets} sheets`);
console.log(`  skipped ${active.stats.suspendedSkipped} suspended notes`);
console.log(`\nspeedup: ${(allMs / activeMs).toFixed(1)}x   work avoided: ${(100 - (aCards + aSheets) / (allCards + allSheets) * 100).toFixed(1)}%`);

// scheduling must still be right on what we did import
const withSched = active.decks.flatMap((d) => d.cards).filter((c) => c.schedule && c.schedule.size);
console.log(`\nimported cards carrying schedules: ${withSched.length}`);
const anySuspendedLeft = active.decks
  .flatMap((d) => d.cards)
  .filter((c) => [...(c.schedule?.values() ?? [])].every((e) => e.suspended) && (c.schedule?.size ?? 0) > 0);
console.log(`fully-suspended notes that slipped through: ${anySuspendedLeft.length}`);
