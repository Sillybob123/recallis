import { openAsBlob, statSync } from "node:fs";
import initSqlJs from "sql.js";
import { openApkg, probeApkg, parseApkg } from "../src/lib/apkgParse";

const path = "example of decks/collection-2026-08-08@07-50-45.colpkg";
console.log(`package: ${(statSync(path).size / 1024 / 1024).toFixed(0)} MB on disk`);

const mb = () => (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0);
const rss = () => (process.memoryUsage().rss / 1024 / 1024).toFixed(0);
console.log(`baseline heap ${mb()} MB / rss ${rss()} MB`);

// JSZip only accepts Blob in the browser; Node gets the bytes directly.
// Either way the package is opened once and shared.
let t = performance.now();
// openAsBlob keeps the file on disk and reads ranges on demand — exactly
// what a browser File from an <input> does. Nothing is loaded up front.
const blob = await openAsBlob(path);
const pkg = await openApkg(blob, () => initSqlJs());
console.log(`open:  ${(performance.now() - t).toFixed(0)}ms  heap ${mb()} MB / rss ${rss()} MB`);

t = performance.now();
const probe = await probeApkg(pkg);
console.log(`probe: ${(performance.now() - t).toFixed(0)}ms  heap ${mb()} MB / rss ${rss()} MB`);
console.log(`   ${probe.totalNotes} notes, ${probe.activeNotes} active, ${probe.suspendedNotes} suspended`);

t = performance.now();
const parsed = await parseApkg(pkg, { excludeSuspended: true });
const cards = parsed.decks.reduce((n, d) => n + d.cards.length, 0);
const sheets = parsed.decks.reduce((n, d) => n + d.sheets.length, 0);
console.log(`parse: ${(performance.now() - t).toFixed(0)}ms  heap ${mb()} MB / rss ${rss()} MB`);
console.log(`   -> ${cards} cards, ${sheets} sheets (skipped ${parsed.stats.suspendedSkipped})`);

// The same handle is reused for media, so nothing is re-read from disk.
const { readMediaBytes } = await import("../src/lib/apkgParse");
const firstSheet = parsed.decks.flatMap((d) => d.sheets)[0];
if (firstSheet) {
  const bytes = await readMediaBytes(parsed, firstSheet.imageName);
  console.log(`media read: ${bytes ? (bytes.length / 1024).toFixed(0) + " KB" : "missing"}  heap ${mb()} MB`);
}
