import JSZip from "jszip";
import { ref, getBlob } from "firebase/storage";
import { storage } from "../firebase";
import type { Card, OcclusionSheet, OcclusionShape } from "../types";
import { serializeAnkiFile } from "./ankiTsv";
import {
  annotationsOf,
  buildUnits,
  coversOf,
  drawAnnotationOnCanvas,
  fillShapeOnCanvas,
  isCardShape,
} from "./shapes";
import { EXPORT_QUALITY, exportDimensions } from "./exportImage";
import { formatTagString } from "./tags";

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
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      EXPORT_QUALITY
    );
  });
}

function exportCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const { width, height } = exportDimensions(
    img.naturalWidth,
    img.naturalHeight
  );
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Word-wraps and centers a text-box mask's prompt inside its rectangle. */
function drawPromptText(
  ctx: CanvasRenderingContext2D,
  s: OcclusionShape,
  W: number,
  H: number
) {
  const text = s.label?.trim();
  if (!text) return;
  const boxX = s.x * W;
  const boxY = s.y * H;
  const boxW = s.w * W;
  const boxH = s.h * H;
  const pad = Math.min(boxW, boxH) * 0.08;

  // Start large and shrink until the wrapped text fits the box.
  for (let size = Math.floor(boxH * 0.45); size >= 9; size -= 2) {
    ctx.font = `600 ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const attempt = line ? `${line} ${word}` : word;
      if (ctx.measureText(attempt).width <= boxW - pad * 2 || !line) {
        line = attempt;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
    const lineHeight = size * 1.2;
    if (lines.length * lineHeight <= boxH - pad * 2 || size === 9) {
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 3;
      const startY = boxY + boxH / 2 - ((lines.length - 1) * lineHeight) / 2;
      lines.forEach((l, i) =>
        ctx.fillText(l, boxX + boxW / 2, startY + i * lineHeight, boxW - pad * 2)
      );
      ctx.shadowBlur = 0;
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
      return;
    }
  }
}

/** Draws the base image with the given normalized shapes filled solid (masked). */
async function bakeMasked(
  img: HTMLImageElement,
  shapes: OcclusionShape[],
  /** the whole sheet, for the covers and marks that belong on every card */
  all: OcclusionShape[] = shapes
): Promise<Blob> {
  const canvas = exportCanvas(img);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const s of shapes) {
    if (!isCardShape(s)) continue;
    fillShapeOnCanvas(ctx, s, canvas.width, canvas.height);
  }
  for (const s of coversOf(all)) {
    fillShapeOnCanvas(ctx, s, canvas.width, canvas.height);
  }
  // Text-box prompts are part of the question, so they bake into the image
  // and survive the trip to Anki without any special note type.
  for (const s of shapes) {
    if (isCardShape(s) && s.textPrompt) {
      drawPromptText(ctx, s, canvas.width, canvas.height);
    }
  }
  // Arrows, stars and labels go on last so a mask can't cover them.
  for (const s of annotationsOf(all)) {
    drawAnnotationOnCanvas(ctx, s, canvas.width, canvas.height);
  }
  return canvasToBlob(canvas);
}

/** The answer image: the masks lifted, but covers and marks still on it. */
async function bakeOriginal(
  img: HTMLImageElement,
  shapes: OcclusionShape[] = []
): Promise<Blob> {
  const canvas = exportCanvas(img);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const s of coversOf(shapes)) {
    fillShapeOnCanvas(ctx, s, canvas.width, canvas.height);
  }
  for (const s of annotationsOf(shapes)) {
    drawAnnotationOnCanvas(ctx, s, canvas.width, canvas.height);
  }
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
    const tags = formatTagString(card.tags);
    if (card.data.type === "basic") {
      rows.push(["Basic", deckName, card.data.front, card.data.back, tags]);
    } else {
      rows.push(["Cloze", deckName, card.data.text, card.data.extra ?? "", tags]);
    }
  }

  let mediaCount = 0;
  for (const sheet of sheets) {
    if (buildUnits(sheet.shapes).length === 0) continue;
    try {
      const blob = await getBlob(ref(storage, sheet.imagePath));
      const img = await loadImageFromBlob(blob);

      const answerBlob = await bakeOriginal(img, sheet.shapes);
      const answerName = `occ_${sheet.id}_answer.jpg`;
      media.file(answerName, answerBlob);
      mediaCount++;

      // One card per unit: grouped masks bake into a single question image.
      const shapeById = new Map(sheet.shapes.map((s) => [s.id, s]));
      for (const unit of buildUnits(sheet.shapes)) {
        const unitShapes = unit.shapeIds
          .map((id) => shapeById.get(id))
          .filter((s): s is OcclusionShape => Boolean(s));
        // On a text-box mask the label is the prompt already drawn onto the
        // question image — echoing it above the answer just looks like a
        // stray caption.
        const answerLabel = unitShapes.some((s) => s.textPrompt)
          ? ""
          : unit.label ?? "";
        const qBlob = await bakeMasked(img, unitShapes, sheet.shapes);
        const qName = `occ_${sheet.id}_${unit.key.replace(/[^a-z0-9-]/gi, "")}_q.jpg`;
        media.file(qName, qBlob);
        mediaCount++;
        rows.push([
          "Basic",
          deckName,
          `<img src="${qName}">`,
          `${answerLabel ? `<b>${answerLabel}</b><br>` : ""}<img src="${answerName}">`,
          formatTagString(sheet.tags),
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
    // Fields are columns 3-4; tags ride in column 5 so Anki restores them.
    tagsColumn: 5,
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
