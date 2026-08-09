import initSqlJs from "sql.js";
import { parseApkg, readMediaBytes } from "/Users/yairben-dor/XCode/MedicalQuizlet/src/lib/apkgParse";

const { openAsBlob } = await import("node:fs");
const { openApkg } = await import("/Users/yairben-dor/XCode/MedicalQuizlet/src/lib/apkgParse");
const blob = await openAsBlob(
  "/Users/yairben-dor/XCode/MedicalQuizlet/example of decks/AnatomyApkcg.apkg"
);
const parsed = await parseApkg(await openApkg(blob, () => initSqlJs()));

console.log("stats:", JSON.stringify(parsed.stats, null, 1));
console.log("\ndecks:");
for (const d of parsed.decks) {
  console.log(` ${d.name}: ${d.cards.length} cards, ${d.sheets.length} sheets`);
  for (const s of d.sheets.slice(0, 2)) {
    const groups = new Set(s.shapes.map(sh => sh.groupId).filter(Boolean));
    console.log(`   sheet "${s.title}" img=${s.imageName} ${s.imageWidth}x${s.imageHeight} shapes=${s.shapes.length} groups=${groups.size}`);
    console.log(`     first shape:`, JSON.stringify(s.shapes[0]));
  }
}

// Verify media bytes retrievable for a sheet image
const sheet = parsed.decks.flatMap(d => d.sheets)[0];
const bytes = await readMediaBytes(parsed, sheet.imageName);
console.log(`\nmedia fetch "${sheet.imageName}":`, bytes ? `${bytes.length} bytes, magic=${bytes[0].toString(16)}${bytes[1].toString(16)}` : "MISSING");

// Verify a card image reference resolves too
const cardWithImg = parsed.decks.flatMap(d => d.cards).find(c =>
  (c.type === "cloze" ? (c.extra ?? "") + c.text : c.front + c.back).includes("<img"));
if (cardWithImg) {
  const html = cardWithImg.type === "cloze" ? (cardWithImg.extra ?? "") + cardWithImg.text : cardWithImg.front + cardWithImg.back;
  const src = html.match(/<img[^>]*src="([^"]+)"/)?.[1];
  const b = src ? await readMediaBytes(parsed, src) : null;
  console.log(`card img "${src}":`, b ? `${b.length} bytes OK` : "MISSING");
}
