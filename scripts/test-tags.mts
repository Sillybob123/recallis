import { readFileSync } from "node:fs";
import initSqlJs from "sql.js";
import { openApkg, parseApkg } from "../src/lib/apkgParse";
import { parseTagString, normalizeTags, addTags, removeTags, tagMatches, formatTagString } from "../src/lib/tags";

// --- helper behavior ---
console.log("Anki-style string:", JSON.stringify(parseTagString("  anatomy   thorax::breast  ")));
console.log("dedupe + case:    ", normalizeTags(["Anatomy", "anatomy", "thorax"]));
console.log("spaces -> ::      ", normalizeTags(["breast and thorax"]));
console.log("add:              ", addTags(["anatomy"], ["thorax", "anatomy"]));
console.log("remove:           ", removeTags(["anatomy", "thorax"], ["ANATOMY"]));
console.log("hierarchy match:  ", tagMatches("anatomy::thorax", "anatomy"), tagMatches("anatomyx", "anatomy"));
console.log("export format:    ", JSON.stringify(formatTagString(["thorax", "anatomy"])));

// --- real packages ---
for (const path of [
  "example of decks/AnatomyApkcg.apkg",
  "example of decks/collection-2026-08-08@07-50-45.colpkg",
]) {
  const buf = readFileSync(path);
  const pkg = await parseApkg(
    await openApkg(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      () => initSqlJs()
    )
  );
  const cardTags = pkg.decks.flatMap((d) => d.cards.flatMap((c) => c.tags));
  const sheetTags = pkg.decks.flatMap((d) => d.sheets.flatMap((s) => s.tags));
  const unique = [...new Set([...cardTags, ...sheetTags])];
  const tagged = pkg.decks.flatMap((d) => d.cards).filter((c) => c.tags.length > 0).length;
  console.log(`\n${path.split("/").pop()}`);
  console.log(`  ${tagged} tagged cards, ${unique.length} distinct tags`);
  console.log("  sample:", unique.slice(0, 8));
}
