// Parses Anki-style cloze syntax: {{c1::answer}} or {{c1::answer::hint}}

import type { CardData } from "../types";

const CLOZE_RE = /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/gs;
const HAS_CLOZE_RE = /\{\{c\d+::/;

export function hasClozeMarkup(text: string): boolean {
  return HAS_CLOZE_RE.test(text);
}

/**
 * Treats a basic card whose front carries cloze markup as the cloze card it
 * obviously is.
 *
 * Imports used to decide cloze-ness from the note type's *name*, so a deck
 * whose type was called "Basic-000c0" landed here as a basic card with a
 * literal "{{c1::6-10}}" on its front. The importer looks at the content now,
 * but cards stored before that would still read as raw markup — this repairs
 * them on the way to the screen, without rewriting anything on disk.
 */
export function normalizeCardData(data: CardData): CardData {
  if (data.type !== "basic" || !hasClozeMarkup(data.front)) return data;
  return {
    type: "cloze",
    text: data.front,
    extra: data.back || undefined,
  };
}

export interface ClozeMatch {
  full: string;
  index: number;
  num: number;
  answer: string;
  hint?: string;
}

export function findClozeNumbers(text: string): number[] {
  const nums = new Set<number>();
  for (const m of text.matchAll(CLOZE_RE)) {
    nums.add(Number(m[1]));
  }
  return Array.from(nums).sort((a, b) => a - b);
}

/**
 * Renders cloze text as HTML for a given active cloze number.
 * - The active number's occurrences become a blank (with hint if provided).
 * - Other cloze numbers are revealed as plain text (their answer shown).
 */
export function renderClozeQuestion(text: string, activeNum: number): string {
  return text.replace(CLOZE_RE, (_full, numStr, answer, hint) => {
    const num = Number(numStr);
    if (num === activeNum) {
      const label = hint ? `[${hint}]` : "[...]";
      return `<span class="cloze-blank">${escapeHtml(label)}</span>`;
    }
    return answer;
  });
}

/** Renders cloze text with every deletion revealed (the answer view). */
export function renderClozeAnswer(text: string, activeNum: number): string {
  return text.replace(CLOZE_RE, (_full, numStr, answer) => {
    const num = Number(numStr);
    if (num === activeNum) {
      return `<span class="cloze-answer">${answer}</span>`;
    }
    return answer;
  });
}

/** Strips cloze markup entirely, leaving plain revealed text (for previews/export). */
export function stripCloze(text: string): string {
  return text.replace(CLOZE_RE, (_full, _num, answer) => answer);
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
