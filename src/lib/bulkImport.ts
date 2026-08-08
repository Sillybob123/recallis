import type { BasicCardData, ClozeCardData } from "../types";

export type TermSeparator = "\t" | "," | " - ";
export type CardSeparator = "\n" | "\n\n";

/** Quizlet-style bulk paste: "term<sep>definition" per line, cards split by line or blank line. */
export function parseBasicBulk(
  text: string,
  termSep: TermSeparator,
  cardSep: CardSeparator
): BasicCardData[] {
  const rawCards = text
    .split(cardSep === "\n\n" ? /\n\s*\n/ : "\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const cards: BasicCardData[] = [];
  for (const raw of rawCards) {
    const idx = raw.indexOf(termSep);
    if (idx === -1) continue;
    const front = raw.slice(0, idx).trim();
    const back = raw.slice(idx + termSep.length).trim();
    if (front && back) {
      cards.push({ type: "basic", front, back });
    }
  }
  return cards;
}

/** Bulk cloze import: one cloze card per blank-line-separated block. Blocks with no {{c#::}} are skipped. */
export function parseClozeBulk(text: string): ClozeCardData[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const cards: ClozeCardData[] = [];
  for (const block of blocks) {
    if (/\{\{c\d+::/.test(block)) {
      cards.push({ type: "cloze", text: block });
    }
  }
  return cards;
}
