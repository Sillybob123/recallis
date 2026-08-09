import { parseAnkiFile } from "./ankiTsv";
import type { CardData } from "../types";
import { parseTagString } from "./tags";

export interface ImportedNote {
  data: CardData;
  /** tags from the file's tags column, normalized */
  tags: string[];
}

export interface ImportedDeckGroup {
  /** Full Anki deck name, e.g. "Anatomy::Lab00::Positions" ("" if no deck column). */
  ankiDeck: string;
  cards: ImportedNote[];
}

export interface AnkiImportResult {
  groups: ImportedDeckGroup[];
  totalBasic: number;
  totalCloze: number;
  skippedImageOcclusion: number;
  skippedEmpty: number;
}

const CLOZE_MARKER = /\{\{c\d+::/;

function isImageOcclusionNotetype(notetype: string): boolean {
  return /image\s*occlusion/i.test(notetype);
}

function isClozeNotetype(notetype: string): boolean {
  return /cloze/i.test(notetype);
}

/**
 * Parses an Anki .txt export into card groups.
 *
 * Column handling: Anki's header directives give 1-indexed positions for
 * guid/notetype/deck/tags columns; every remaining column is a note field, in
 * order. Cloze notes use field 1 as Text and field 2 as Back Extra; basic
 * notes use field 1/2 as Front/Back. Rows whose notetype mentions "Image
 * Occlusion" are counted but skipped — their media files (the SVG masks and
 * base images) don't exist inside a .txt export, so they cannot be
 * reconstructed from the text file alone.
 */
export function importAnkiText(text: string): AnkiImportResult {
  const { headers, rows } = parseAnkiFile(text);

  const metaCols = new Set(
    [
      headers.guidColumn,
      headers.notetypeColumn,
      headers.deckColumn,
      headers.tagsColumn,
    ].filter((n): n is number => typeof n === "number" && n > 0)
  );

  const groupsByDeck = new Map<string, ImportedNote[]>();
  let totalBasic = 0;
  let totalCloze = 0;
  let skippedImageOcclusion = 0;
  let skippedEmpty = 0;

  for (const row of rows) {
    const notetype = headers.notetypeColumn
      ? (row[headers.notetypeColumn - 1] ?? "")
      : "";
    const ankiDeck = headers.deckColumn
      ? (row[headers.deckColumn - 1] ?? "").trim()
      : "";
    const tags = headers.tagsColumn
      ? parseTagString(row[headers.tagsColumn - 1] ?? "")
      : [];

    if (isImageOcclusionNotetype(notetype)) {
      skippedImageOcclusion++;
      continue;
    }

    // Collect note fields = all columns that aren't meta columns.
    const fields: string[] = [];
    for (let i = 0; i < row.length; i++) {
      if (!metaCols.has(i + 1)) fields.push(row[i]);
    }
    // Trim trailing empty fields but keep interior positions.
    while (fields.length && fields[fields.length - 1].trim() === "") {
      fields.pop();
    }

    const first = (fields[0] ?? "").trim();
    const second = (fields[1] ?? "").trim();

    if (!first) {
      skippedEmpty++;
      continue;
    }

    const treatAsCloze =
      isClozeNotetype(notetype) || (!notetype && CLOZE_MARKER.test(first));

    let card: CardData;
    if (treatAsCloze) {
      if (!CLOZE_MARKER.test(first)) {
        // A "cloze" note with no actual deletions still works as a basic card
        // rather than silently disappearing.
        if (!second) {
          skippedEmpty++;
          continue;
        }
        card = { type: "basic", front: first, back: second };
        totalBasic++;
      } else {
        card = { type: "cloze", text: first, extra: second || undefined };
        totalCloze++;
      }
    } else {
      if (!second) {
        skippedEmpty++;
        continue;
      }
      card = { type: "basic", front: first, back: second };
      totalBasic++;
    }

    const list = groupsByDeck.get(ankiDeck) ?? [];
    list.push({ data: card, tags });
    groupsByDeck.set(ankiDeck, list);
  }

  const groups: ImportedDeckGroup[] = Array.from(groupsByDeck.entries()).map(
    ([ankiDeck, cards]) => ({ ankiDeck, cards })
  );

  return { groups, totalBasic, totalCloze, skippedImageOcclusion, skippedEmpty };
}

/** "Anatomy::Lab00::Positions" -> "Anatomy Lab00 Positions" for a deck name. */
export function ankiDeckToName(ankiDeck: string): string {
  return ankiDeck.trim() || "Imported deck";
}
