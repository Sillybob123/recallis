import type { SqlJsStatic } from "sql.js";
import {
  parseApkg,
  readMediaBytes,
  type ParsedApkg,
  type ParsedSheet,
} from "./apkgParse";
import {
  contentTypeForFilename,
  createCardsBulk,
  createDeck,
  createOcclusionSheet,
  uploadDeckMedia,
  uploadOcclusionImage,
} from "./firestore";
import type { CardData } from "../types";

const DECK_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#ec4899"];

/** Vite-friendly sql.js loader: wasm served as an asset, initialized once. */
let sqlPromise: Promise<SqlJsStatic> | null = null;
async function loadSqlBrowser(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
        import("sql.js"),
        import("sql.js/dist/sql-wasm.wasm?url"),
      ]);
      return initSqlJs({ locateFile: () => wasmUrl });
    })();
  }
  return sqlPromise;
}

export async function parseApkgInBrowser(file: File): Promise<ParsedApkg> {
  const data = await file.arrayBuffer();
  return parseApkg(data, loadSqlBrowser);
}

export interface ApkgImportProgress {
  stage: string;
  done: number;
  total: number;
}

export interface ApkgImportOutcome {
  decksCreated: number;
  cardsCreated: number;
  sheetsCreated: number;
  masksCreated: number;
  mediaUploaded: number;
  warnings: string[];
}

const IMG_SRC_RE = /(<img\b[^>]*\bsrc=")([^"]+)(")/gi;

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

function collectImgSrcs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(IMG_SRC_RE)) {
    const src = decodeEntities(m[2]);
    if (!/^https?:|^data:/i.test(src)) out.push(src);
  }
  return out;
}

function stripSoundTags(html: string): string {
  return html.replace(/\[sound:[^\]]*\]/g, "");
}

async function loadImageDims(bytes: Uint8Array, name: string): Promise<{ w: number; h: number }> {
  const type = contentTypeForFilename(name) ?? "image/png";
  const buf = new Uint8Array(bytes).buffer as ArrayBuffer;
  const blob = new Blob([buf], { type });
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => reject(new Error(`Could not decode image ${name}`));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Creates decks/cards/occlusion sheets in Firebase from a parsed package.
 * Media referenced by cards is uploaded to Storage (once per file per deck)
 * and the card HTML rewritten to the hosted URLs, so images display in-app.
 */
export async function importParsedApkg(
  uid: string,
  parsed: ParsedApkg,
  opts: {
    split: boolean;
    singleDeckName: string;
    onProgress?: (p: ApkgImportProgress) => void;
  }
): Promise<ApkgImportOutcome> {
  const warnings = [...parsed.stats.warnings];
  let decksCreated = 0;
  let cardsCreated = 0;
  let sheetsCreated = 0;
  let masksCreated = 0;
  let mediaUploaded = 0;

  const totalWork = parsed.decks.reduce(
    (n, d) => n + d.cards.length + d.sheets.length,
    0
  );
  let workDone = 0;
  const progress = (stage: string) =>
    opts.onProgress?.({ stage, done: workDone, total: totalWork });

  interface TargetDeck {
    deckId: string;
    mediaUrlCache: Map<string, string | null>;
  }

  let colorIdx = 0;
  let single: TargetDeck | null = null;

  async function makeDeck(name: string): Promise<TargetDeck> {
    const deckId = await createDeck(
      uid,
      name,
      "Imported from Anki",
      DECK_COLORS[colorIdx++ % DECK_COLORS.length]
    );
    decksCreated++;
    return { deckId, mediaUrlCache: new Map() };
  }

  async function resolveMediaUrl(
    target: TargetDeck,
    name: string
  ): Promise<string | null> {
    if (target.mediaUrlCache.has(name)) {
      return target.mediaUrlCache.get(name)!;
    }
    let url: string | null = null;
    try {
      const bytes = await readMediaBytes(parsed, name);
      if (bytes && contentTypeForFilename(name)) {
        const up = await uploadDeckMedia(uid, target.deckId, name, bytes);
        url = up.url;
        mediaUploaded++;
      } else if (bytes) {
        warnings.push(`"${name}" isn't an image — skipped (audio/video isn't supported).`);
      } else {
        warnings.push(`"${name}" referenced by a card but missing from the package.`);
      }
    } catch (err) {
      warnings.push(`Upload failed for "${name}": ${(err as Error).message}`);
    }
    target.mediaUrlCache.set(name, url);
    return url;
  }

  async function rewriteHtml(target: TargetDeck, html: string): Promise<string> {
    const cleaned = stripSoundTags(html);
    const srcs = collectImgSrcs(cleaned);
    if (srcs.length === 0) return cleaned;
    const replacements = new Map<string, string>();
    for (const src of srcs) {
      const url = await resolveMediaUrl(target, src);
      if (url) replacements.set(src, url);
    }
    return cleaned.replace(IMG_SRC_RE, (full, pre, src, post) => {
      const url = replacements.get(decodeEntities(src));
      return url ? `${pre}${url}${post}` : full;
    });
  }

  async function importSheet(target: TargetDeck, sheet: ParsedSheet) {
    const bytes = await readMediaBytes(parsed, sheet.imageName);
    if (!bytes) {
      warnings.push(
        `Occlusion sheet "${sheet.title}": image ${sheet.imageName} missing from package.`
      );
      return;
    }
    let width = sheet.imageWidth;
    let height = sheet.imageHeight;
    let shapes = sheet.shapes;
    if (!width || !height || sheet.needsPixelNormalize) {
      const dims = await loadImageDims(bytes, sheet.imageName);
      width = dims.w;
      height = dims.h;
      if (sheet.needsPixelNormalize) {
        shapes = shapes.map((s) => ({
          ...s,
          x: s.x / dims.w,
          y: s.y / dims.h,
          w: s.w / dims.w,
          h: s.h / dims.h,
          points: s.points?.map((p) => ({ x: p.x / dims.w, y: p.y / dims.h })),
        }));
      }
    }
    const ext = sheet.imageName.split(".").pop() || "png";
    const type = contentTypeForFilename(sheet.imageName) ?? "image/png";
    const buf = new Uint8Array(bytes).buffer as ArrayBuffer;
    const asFile = new File([buf], `import.${ext}`, { type });
    const { path, url } = await uploadOcclusionImage(uid, target.deckId, asFile);
    await createOcclusionSheet(uid, target.deckId, {
      title: sheet.title,
      imagePath: path,
      imageUrl: url,
      imageWidth: Math.round(width),
      imageHeight: Math.round(height),
      shapes,
    });
    sheetsCreated++;
    masksCreated += shapes.length;
  }

  for (const deck of parsed.decks) {
    let target: TargetDeck;
    if (opts.split) {
      target = await makeDeck(deck.name);
    } else {
      if (!single) {
        single = await makeDeck(opts.singleDeckName || "Imported deck");
      }
      target = single;
    }

    // Cards: rewrite media references, then bulk-create.
    const rewritten: CardData[] = [];
    for (const card of deck.cards) {
      progress(`Uploading card images (${deck.name})`);
      if (card.type === "basic") {
        rewritten.push({
          type: "basic",
          front: await rewriteHtml(target, card.front),
          back: await rewriteHtml(target, card.back),
        });
      } else {
        rewritten.push({
          type: "cloze",
          text: await rewriteHtml(target, card.text),
          extra: card.extra ? await rewriteHtml(target, card.extra) : undefined,
        });
      }
      workDone++;
    }
    if (rewritten.length) {
      progress(`Saving cards (${deck.name})`);
      try {
        await createCardsBulk(uid, target.deckId, rewritten);
        cardsCreated += rewritten.length;
      } catch (err) {
        warnings.push(
          `Saving cards for "${deck.name}" failed: ${(err as Error).message}`
        );
      }
    }

    for (const sheet of deck.sheets) {
      progress(`Building occlusion sheet: ${sheet.title}`);
      try {
        await importSheet(target, sheet);
      } catch (err) {
        warnings.push(
          `Occlusion sheet "${sheet.title}" failed: ${(err as Error).message}`
        );
      }
      workDone++;
    }
  }

  progress("Done");
  return { decksCreated, cardsCreated, sheetsCreated, masksCreated, mediaUploaded, warnings };
}
