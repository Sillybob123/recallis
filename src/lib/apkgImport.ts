import type { SqlJsStatic } from "sql.js";
import {
  openApkg,
  parseApkg,
  probeApkg,
  readMediaBytes,
  type ApkgProbe,
  type OpenApkg,
  type ImportedSchedule,
  type ParsedApkg,
  type ParsedSheet,
} from "./apkgParse";
import { findClozeNumbers } from "./cloze";
import { buildUnits } from "./shapes";
import { retry } from "./netRetry";
import { newSrsState, type SrsState } from "./srs";
import { startOfStudyDay } from "./settings";
import {
  contentTypeForFilename,
  countItemsWithoutImportId,
  createCardsBulk,
  findCardsByImportIds,
  findSheetsByImportIds,
  getSrsMap,
  setItemTags,
  listDecksOnce,
  getCardsOnce,
  getOcclusionsOnce,
  setSrsState,
  createDeck,
  createOcclusionSheet,
  uploadDeckMedia,
  uploadOcclusionImage,
} from "./firestore";
import type { CardData, Deck } from "../types";
import { findDeckByPath } from "./deckPath";
import { addTags, normalizeTags } from "./tags";

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

/**
 * Opens a package once. The File is handed straight to JSZip so the bytes
 * aren't also held as an ArrayBuffer on our side — the difference matters on
 * a several-hundred-megabyte collection.
 */
export async function openApkgInBrowser(file: File) {
  return openApkg(file, loadSqlBrowser);
}

export async function parseApkgInBrowser(
  pkg: OpenApkg,
  options: { excludeSuspended?: boolean } = {}
): Promise<ParsedApkg> {
  return parseApkg(pkg, options);
}

/** Fast look at a package's contents before committing to a full parse. */
export async function probeApkgInBrowser(pkg: OpenApkg): Promise<ApkgProbe> {
  return probeApkg(pkg);
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
  schedulesRestored: number;
  /** notes already present, skipped instead of duplicated */
  duplicatesSkipped: number;
  /** existing notes that gained tags from the package */
  tagsUpdated: number;
  warnings: string[];
}

/**
 * Fallback identity for cards imported before importId existed: the note's
 * text with markup and spacing normalized away, which is close to how Anki
 * itself detects duplicates.
 */
function contentKey(data: CardData): string {
  const raw =
    data.type === "cloze" ? data.text : `${data.front}\u241f${data.back}`;
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Converts Anki's SM-2 record into our FSRS state. Stability starts at the
 * interval Anki had already earned, and difficulty is derived from the ease
 * factor (1.3 = hardest, 2.5 = default, 3.0+ = easy), so a mature card keeps
 * its spacing instead of restarting from scratch.
 */
function srsFromAnki(entry: ImportedSchedule): SrsState {
  const now = Date.now();
  const base = newSrsState(now);

  // Suspended/buried new cards: keep them new (reps 0) but parked.
  if (entry.isNew) {
    return {
      ...base,
      suspended: entry.suspended || undefined,
      buriedUntil: entry.buried ? nextDayStartFrom(now) : null,
    };
  }

  const difficulty = Math.min(Math.max(10 - (entry.ease - 1.3) * 4.12, 1), 10);

  // These timestamps drive the daily limits. Stamping them "now" would make an
  // import look like hundreds of cards introduced today, zeroing out the
  // new-card allowance. The real last review is one interval before the due
  // date; either way it must land before today started.
  const DAY = 86400000;
  const estimatedLastReview =
    entry.phase === "review" ? entry.due - entry.ivl * DAY : entry.due - 10 * 60000;
  const beforeToday = Math.min(estimatedLastReview, startOfStudyDay(now) - 1000);

  return {
    ...base,
    phase: entry.phase,
    step: 0,
    ease: entry.ease,
    ivl: entry.ivl,
    due: entry.due,
    reps: entry.reps,
    lapses: entry.lapses,
    stab: Math.max(entry.ivl, 0.5),
    diff: difficulty,
    lastReviewAt: beforeToday,
    firstSeen: Math.min(beforeToday - entry.reps * DAY, beforeToday),
    lastReviewed: beforeToday,
    suspended: entry.suspended || undefined,
    buriedUntil: entry.buried ? nextDayStartFrom(now) : null,
  };
}

/**
 * Whether a stored schedule already matches what the package says. A new card
 * has no due date worth comparing — `newSrsState` stamps it with the current
 * time — so identity there is just "still new, still parked".
 */
function sameSchedule(current: SrsState, next: SrsState, isNew: boolean): boolean {
  if (Boolean(current.suspended) !== Boolean(next.suspended)) return false;
  if (isNew) return current.reps === 0 && current.phase === next.phase;
  return (
    current.phase === next.phase &&
    current.due === next.due &&
    current.ivl === next.ivl &&
    current.reps === next.reps &&
    current.lapses === next.lapses
  );
}

function nextDayStartFrom(now: number): number {
  const d = new Date(now);
  d.setHours(4, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
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
  // Blob copies the view itself; wrapping it in another Uint8Array first
  // would double the peak memory for every image in a big package.
  const blob = new Blob([bytes as unknown as BlobPart], { type });
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
    /** carry over Anki's due dates and intervals when the package has them */
    importSchedule: boolean;
    onProgress?: (p: ApkgImportProgress) => void;
    signal?: AbortSignal;
  }
): Promise<ApkgImportOutcome> {
  const warnings = [...parsed.stats.warnings];
  let decksCreated = 0;
  let cardsCreated = 0;
  let sheetsCreated = 0;
  let masksCreated = 0;
  let mediaUploaded = 0;
  let schedulesRestored = 0;
  let duplicatesSkipped = 0;
  let tagsUpdated = 0;

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
    /** existing cards in this deck, by importId and by content */
    cardIndex: Map<string, string>;
    /** current tags of existing cards, so re-imports can union rather than wipe */
    cardTagsById: Map<string, string[]>;
    sheetIndex: Map<string, string>;
    /** existing scheduling, so unchanged cards aren't rewritten */
    srs: Map<string, SrsState>;
    /** true once content-based matching is either done or known unnecessary */
    legacyIndexed: boolean;
    srsLoaded: boolean;
  }

  let colorIdx = 0;
  let single: TargetDeck | null = null;
  const existingDecks = await listDecksOnce(uid).catch(() => [] as Deck[]);

  /**
   * Finds the deck of this name or creates it. Reusing it is what turns a
   * second import of the same package into a merge rather than a duplicate.
   */
  async function makeDeck(name: string): Promise<TargetDeck> {
    const existing = findDeckByPath(existingDecks, name);
    if (existing) {
      const reused: TargetDeck = {
        deckId: existing.id,
        mediaUrlCache: new Map(),
        cardIndex: new Map(),
        cardTagsById: new Map(),
        sheetIndex: new Map(),
        srs: new Map(),
        legacyIndexed: false,
        srsLoaded: false,
      };
      return reused;
    }
    const deckId = await createDeck(
      uid,
      name,
      "Imported from Anki",
      DECK_COLORS[colorIdx++ % DECK_COLORS.length]
    );
    existingDecks.push({
      id: deckId,
      name,
      color: "#6366f1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    decksCreated++;
    return {
      deckId,
      mediaUrlCache: new Map(),
      cardIndex: new Map(),
      cardTagsById: new Map(),
      sheetIndex: new Map(),
      srs: new Map(),
      // A brand-new deck has nothing to match against.
      legacyIndexed: true,
      srsLoaded: true,
    };
  }

  /**
   * Learns which of *these* notes the deck already has.
   *
   * Asking by import id costs one query per 30 notes and returns only
   * matches, so re-importing next week's export doesn't have to read a deck
   * that has grown to thousands of cards. The full scan is kept purely as a
   * fallback for cards imported before import ids existed, and only runs if
   * something actually failed to match.
   */
  async function indexExisting(
    target: TargetDeck,
    cardImportIds: string[],
    sheetImportIds: string[]
  ) {
    try {
      const [cardHits, sheetHits] = await Promise.all([
        findCardsByImportIds(uid, target.deckId, cardImportIds),
        findSheetsByImportIds(uid, target.deckId, sheetImportIds),
      ]);
      for (const [importId, hit] of cardHits) {
        target.cardIndex.set(importId, hit.id);
        target.cardTagsById.set(hit.id, hit.tags);
      }
      for (const [importId, sheetId] of sheetHits) {
        target.sheetIndex.set(importId, sheetId);
      }
    } catch {
      /* query unavailable — the legacy scan below still covers us */
    }
  }

  /**
   * True when the deck contains cards or sheets written before import ids —
   * the only case where a content scan can find anything the id lookup
   * missed. Two aggregate queries, no document reads.
   */
  async function hasPreIdItems(target: TargetDeck): Promise<boolean> {
    try {
      const missing = await countItemsWithoutImportId(uid, target.deckId);
      // Nothing to find by content — never ask again for this deck.
      if (missing === 0) target.legacyIndexed = true;
      return missing > 0;
    } catch {
      // Aggregates unavailable — be conservative and scan only if something
      // in this package failed to match by id.
      return true;
    }
  }

  /**
   * One-time full read, used only when some notes didn't match by id. Cards
   * imported before ids existed are matched on normalized content instead.
   */
  async function indexLegacy(target: TargetDeck) {
    if (target.legacyIndexed) return;
    target.legacyIndexed = true;
    try {
      const [existingCards, existingSheets] = await Promise.all([
        getCardsOnce(uid, target.deckId),
        getOcclusionsOnce(uid, target.deckId),
      ]);
      for (const card of existingCards) {
        if (card.importId) target.cardIndex.set(card.importId, card.id);
        target.cardIndex.set(`content:${contentKey(card.data)}`, card.id);
        target.cardTagsById.set(card.id, card.tags ?? []);
      }
      for (const sheet of existingSheets) {
        if (sheet.importId) target.sheetIndex.set(sheet.importId, sheet.id);
        target.sheetIndex.set(`title:${sheet.title.trim().toLowerCase()}`, sheet.id);
      }
    } catch {
      /* couldn't read the deck — fall back to plain insertion */
    }
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
        const up = await retry(
          () => uploadDeckMedia(uid, target.deckId, name, bytes),
          { signal: opts.signal }
        );
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
    const existingSheetId =
      target.sheetIndex.get(sheet.importId) ??
      target.sheetIndex.get(`title:${sheet.title.trim().toLowerCase()}`);
    if (existingSheetId && existingSheetId !== "pending") {
      // Already imported: leave the image and masks alone (they may have been
      // edited here) and only bring the due dates up to date.
      duplicatesSkipped++;
      if (opts.importSchedule && sheet.unitSchedules) {
        const units = buildUnits(sheet.shapes);
        for (let i = 0; i < units.length; i++) {
          const entry = sheet.unitSchedules[i];
          if (!entry) continue;
          const itemKey = `${existingSheetId}-${units[i].key}`;
          const next = srsFromAnki(entry);
          const current = target.srs.get(itemKey);
          if (current && sameSchedule(current, next, entry.isNew)) continue;
          try {
            await retry(
              () => setSrsState(uid, target.deckId, itemKey, next),
              { attempts: 2, timeoutMs: 20000, signal: opts.signal }
            );
            target.srs.set(itemKey, next);
            schedulesRestored++;
          } catch {
            /* one mask's schedule is not worth failing the import */
          }
        }
      }
      return;
    }

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
    const asFile = new File([bytes as unknown as BlobPart], `import.${ext}`, {
      type,
    });
    const { path, url } = await retry(
      () => uploadOcclusionImage(uid, target.deckId, asFile),
      { signal: opts.signal }
    );
    const sheetId = await retry(
      () =>
        createOcclusionSheet(uid, target.deckId, {
          title: sheet.title,
          imagePath: path,
          imageUrl: url,
          imageWidth: Math.round(width),
          imageHeight: Math.round(height),
          shapes,
          importId: sheet.importId,
          tags: normalizeTags(sheet.tags ?? []),
        }),
      { signal: opts.signal }
    );
    target.sheetIndex.set(sheet.importId, sheetId);
    target.sheetIndex.set(`title:${sheet.title.trim().toLowerCase()}`, sheetId);
    sheetsCreated++;
    masksCreated += shapes.length;

    // Every mask is its own card in Anki, so each keeps its own due date.
    if (opts.importSchedule && sheet.unitSchedules) {
      const units = buildUnits(shapes);
      for (let i = 0; i < units.length; i++) {
        const entry = sheet.unitSchedules[i];
        if (!entry) continue;
        try {
          await retry(
            () =>
              setSrsState(
                uid,
                target.deckId,
                `${sheetId}-${units[i].key}`,
                srsFromAnki(entry)
              ),
            { attempts: 2, timeoutMs: 20000, signal: opts.signal }
          );
          schedulesRestored++;
        } catch {
          warnings.push(
            `Couldn't restore the schedule for a mask on "${sheet.title}".`
          );
        }
      }
    }
  }

  for (const deck of parsed.decks) {
    if (opts.signal?.aborted) throw new Error("Import cancelled");
    let target: TargetDeck;
    if (opts.split) {
      target = await makeDeck(deck.name);
    } else {
      if (!single) {
        single = await makeDeck(opts.singleDeckName || "Imported deck");
      }
      target = single;
    }

    // Ask about exactly the notes in this package before touching anything.
    progress(`Checking for duplicates (${deck.name})`);
    await indexExisting(
      target,
      deck.cards.map((c) => c.importId),
      deck.sheets.map((sh) => sh.importId)
    );
    if (!target.legacyIndexed && (await hasPreIdItems(target))) {
      // The deck holds items from before import ids existed; only those need
      // the content scan. A deck that's purely imported never pays for it,
      // no matter how many new notes this package brings.
      await indexLegacy(target);
    }
    // Existing scheduling, so a card whose due date didn't move isn't rewritten.
    if (opts.importSchedule && !target.srsLoaded) {
      target.srsLoaded = true;
      try {
        target.srs = await getSrsMap(uid, target.deckId);
      } catch {
        /* fall through and write unconditionally */
      }
    }

    // Cards: rewrite media references, then insert only what's missing.
    const rewritten: CardData[] = [];
    const schedules: (Map<number, ImportedSchedule> | undefined)[] = [];
    const importIds: (string | undefined)[] = [];
    const cardTags: string[][] = [];
    // Cards already in the deck: keep their id so their schedule can refresh.
    const existingHits: { cardId: string; card: (typeof deck.cards)[number] }[] = [];

    for (const card of deck.cards) {
      if (opts.signal?.aborted) throw new Error("Import cancelled");
      progress(`Checking cards (${deck.name})`);
      const data = card.data;

      const existingId =
        target.cardIndex.get(card.importId) ??
        target.cardIndex.get(`content:${contentKey(data)}`);
      if (existingId) {
        // Same note, already imported — don't duplicate it, just let its
        // scheduling be refreshed below.
        existingHits.push({ cardId: existingId, card });
        duplicatesSkipped++;
        workDone++;
        continue;
      }

      progress(`Uploading card images (${deck.name})`);
      const prepared: CardData =
        data.type === "basic"
          ? {
              type: "basic",
              front: await rewriteHtml(target, data.front),
              back: await rewriteHtml(target, data.back),
            }
          : {
              type: "cloze",
              text: await rewriteHtml(target, data.text),
              extra: data.extra ? await rewriteHtml(target, data.extra) : undefined,
            };
      rewritten.push(prepared);
      schedules.push(card.schedule);
      importIds.push(card.importId);
      cardTags.push(normalizeTags(card.tags ?? []));
      // Guard against the same note appearing twice in one package.
      target.cardIndex.set(card.importId, "pending");
      target.cardIndex.set(`content:${contentKey(prepared)}`, "pending");
      workDone++;
    }
    /** Writes one note's scheduling against whatever card id it lives under. */
    async function applySchedule(
      cardId: string,
      data: CardData,
      schedule: Map<number, ImportedSchedule> | undefined
    ) {
      if (!opts.importSchedule || !schedule) return;
      const numbers = data.type === "cloze" ? findClozeNumbers(data.text) : [1];
      for (const num of numbers) {
        const entry = schedule.get(num);
        if (!entry) continue;
        const itemKey = data.type === "cloze" ? `${cardId}-c${num}` : cardId;
        const current = target.srs.get(itemKey);
        const next = srsFromAnki(entry);
        // Re-importing the same export shouldn't touch a card whose schedule
        // didn't move. Only the fields Anki actually scheduled are compared —
        // timestamps like firstSeen are derived from "now" and would
        // otherwise report a difference on every import.
        if (current && sameSchedule(current, next, entry.isNew)) continue;
        try {
          await retry(() => setSrsState(uid, target.deckId, itemKey, next), {
            attempts: 2,
            timeoutMs: 20000,
            signal: opts.signal,
          });
          target.srs.set(itemKey, next);
          schedulesRestored++;
        } catch {
          warnings.push(`Couldn't restore the schedule for one card in "${deck.name}".`);
        }
      }
    }

    if (rewritten.length) {
      progress(`Saving cards (${deck.name})`);
      try {
        const ids = await retry(
          () => createCardsBulk(uid, target.deckId, rewritten, importIds, cardTags),
          { signal: opts.signal }
        );
        cardsCreated += rewritten.length;
        for (let i = 0; i < ids.length; i++) {
          if (importIds[i]) target.cardIndex.set(importIds[i]!, ids[i]);
          await applySchedule(ids[i], rewritten[i], schedules[i]);
        }
      } catch (err) {
        warnings.push(
          `Saving cards for "${deck.name}" failed: ${(err as Error).message}`
        );
      }
    }

    // Cards that were already here still get the newest due dates and tags.
    if (existingHits.length) {
      progress(`Updating existing cards (${deck.name})`);
      for (const hit of existingHits) {
        if (hit.cardId === "pending") continue;
        if (opts.importSchedule) {
          await applySchedule(hit.cardId, hit.card.data, hit.card.schedule);
        }
        const incoming = normalizeTags(hit.card.tags ?? []);
        if (incoming.length === 0) continue;
        const current = target.cardTagsById.get(hit.cardId) ?? [];
        const merged = addTags(current, incoming);
        // Tags you added here are kept; Anki's are added on top.
        if (merged.length !== current.length) {
          await setItemTags(uid, target.deckId, "card", hit.cardId, merged).catch(
            () => {}
          );
          target.cardTagsById.set(hit.cardId, merged);
          tagsUpdated++;
        }
      }
    }

    for (const sheet of deck.sheets) {
      if (opts.signal?.aborted) throw new Error("Import cancelled");
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
  return {
    decksCreated,
    cardsCreated,
    sheetsCreated,
    masksCreated,
    mediaUploaded,
    schedulesRestored,
    duplicatesSkipped,
    tagsUpdated,
    warnings,
  };
}
