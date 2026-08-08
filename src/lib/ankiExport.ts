import JSZip from "jszip";
import { ref, getBlob } from "firebase/storage";
import { storage } from "../firebase";
import type { Card, OcclusionSheet, OcclusionShape } from "../types";
import { serializeAnkiFile } from "./ankiTsv";
import { buildUnits, fillShapeOnCanvas } from "./shapes";

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

/** Draws the base image with the given normalized shapes filled solid (masked). */
async function bakeMasked(
  img: HTMLImageElement,
  shapes: OcclusionShape[]
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  for (const s of shapes) {
    fillShapeOnCanvas(ctx, s, canvas.width, canvas.height);
  }
  return canvasToBlob(canvas);
}

async function bakeOriginal(img: HTMLImageElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  return canvasToBlob(canvas);
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  warnings: string[];
}

/**
 * Exports a deck as a zip containing a single Anki-importable .txt in the
 * same header-directive format Anki itself exports (and Text2Anki uses):
 *
 *   #separator:tab
 *   #html:true
 *   #notetype column:1
 *   #deck column:2
 *   Cloze<TAB>DeckName<TAB>{{c1::...}} text<TAB>extra
 *   Basic<TAB>DeckName<TAB>front<TAB>back
 *
 * Anki reads the notetype/deck columns natively, so one import maps every
 * row to the right note type and deck automatically. Image-occlusion masks
 * are baked to PNGs in media/ and exported as Basic image cards.
 */
export async function exportDeckToAnki(
  deckName: string,
  cards: Card[],
  sheets: OcclusionSheet[]
): Promise<ExportResult> {
  const zip = new JSZip();
  const media = zip.folder("media")!;
  const warnings: string[] = [];
  const rows: string[][] = [];

  for (const card of cards) {
    if (card.data.type === "basic") {
      rows.push(["Basic", deckName, card.data.front, card.data.back]);
    } else {
      rows.push(["Cloze", deckName, card.data.text, card.data.extra ?? ""]);
    }
  }

  let mediaCount = 0;
  for (const sheet of sheets) {
    if (sheet.shapes.length === 0) continue;
    try {
      const blob = await getBlob(ref(storage, sheet.imagePath));
      const img = await loadImageFromBlob(blob);

      const answerBlob = await bakeOriginal(img);
      const answerName = `occ_${sheet.id}_answer.png`;
      media.file(answerName, answerBlob);
      mediaCount++;

      // One card per unit: grouped masks bake into a single question image.
      const shapeById = new Map(sheet.shapes.map((s) => [s.id, s]));
      for (const unit of buildUnits(sheet.shapes)) {
        const unitShapes = unit.shapeIds
          .map((id) => shapeById.get(id))
          .filter((s): s is OcclusionShape => Boolean(s));
        const qBlob = await bakeMasked(img, unitShapes);
        const qName = `occ_${sheet.id}_${unit.key.replace(/[^a-z0-9-]/gi, "")}_q.png`;
        media.file(qName, qBlob);
        mediaCount++;
        rows.push([
          "Basic",
          deckName,
          `<img src="${qName}">`,
          `${unit.label ? `<b>${unit.label}</b><br>` : ""}<img src="${answerName}">`,
        ]);
      }
    } catch {
      warnings.push(
        `Could not bake images for sheet "${sheet.title}" — your Firebase Storage bucket likely needs CORS configured (see README). It was skipped in this export.`
      );
    }
  }

  const txt = serializeAnkiFile(rows, {
    notetypeColumn: 1,
    deckColumn: 2,
    html: true,
  });
  const safeName = deckName.replace(/[^a-z0-9 _·-]/gi, "").trim() || "deck";
  zip.file(`${safeName}.txt`, txt);

  zip.file(
    "HOW TO IMPORT INTO ANKI.txt",
    `Exported from Recallis — deck "${deckName}"
${new Date().toString()}

HOW TO IMPORT
1. ${mediaCount > 0 ? `Copy every file inside the "media" folder into your Anki collection.media folder (in Anki: Tools > Check Media... shows the folder path).` : "This deck has no media files — skip straight to step 2."}
2. In Anki: File > Import, choose "${safeName}.txt".
3. Anki reads the built-in header lines automatically: the note type column
   and deck column are already mapped, HTML is enabled, separator is Tab.
   Just confirm and click Import.
4. Cloze rows use Anki's native {{c1::...}} syntax and import into the
   built-in Cloze note type, working exactly like cards made in Anki itself.

${warnings.length ? "WARNINGS:\n" + warnings.join("\n") : "No warnings — everything exported cleanly."}
`
  );

  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, filename: `${safeName}-anki-export.zip`, warnings };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
