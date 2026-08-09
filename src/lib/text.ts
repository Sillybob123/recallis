// Anki notes are HTML, and a lot of them put the heading, the term and the
// definition in separate blocks. textContent alone glues those together —
// "Directionality" + "Medial is…" comes out as "DirectionalityMedial is…" —
// so block boundaries have to become real whitespace before the text is read.
const BLOCK_TAGS =
  "p|div|li|tr|td|th|h[1-6]|blockquote|section|article|header|footer|figure|figcaption|dd|dt|dl|ul|ol|table|thead|tbody|tfoot|pre|main|aside|nav|address|fieldset|form";

/**
 * HTML to text, preserving the line structure the card actually shows.
 * Returns newline-separated lines; use `stripHtmlInline` where a single line
 * is wanted.
 */
export function htmlToText(html: string): string {
  const spaced = html
    // Void elements can be swapped for the break outright.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n")
    // For the rest, add the break around the tag rather than replacing it, so
    // the parser still sees well-formed markup and can't reorder anything.
    .replace(new RegExp(`<(${BLOCK_TAGS})(\\s|>)`, "gi"), "\n<$1$2")
    .replace(new RegExp(`</(${BLOCK_TAGS})>`, "gi"), "\n</$1>");

  const div = document.createElement("div");
  div.innerHTML = spaced;
  return (div.textContent ?? "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Same conversion, flattened to one line — for list previews and search. */
export function stripHtmlInline(html: string): string {
  return htmlToText(html).replace(/\n/g, " ").replace(/ {2,}/g, " ").trim();
}

export function stripHtml(html: string): string {
  return htmlToText(html);
}

export function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, "") // drop parenthetical hints
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isCloseMatch(typed: string, correct: string): boolean {
  return gradeAnswer(typed, correct, "moderate");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Quizlet-style grading levels:
 * - strict: exact match after normalizing case/punctuation/parentheticals.
 * - moderate: strict, plus small misspellings (edit distance scaled to length).
 * - relaxed: moderate, plus "general meaning" — enough of the answer's
 *   significant words appear in what you typed.
 */
export function gradeAnswer(
  typed: string,
  correct: string,
  level: "relaxed" | "moderate" | "strict"
): boolean {
  const a = normalizeForCompare(typed);
  const b = normalizeForCompare(correct);
  if (!a || !b) return false;
  if (a === b) return true;
  if (level === "strict") return false;

  const tolerance = Math.max(1, Math.floor(b.length * 0.15));
  if (levenshtein(a, b) <= tolerance) return true;
  if (level === "moderate") return false;

  // relaxed: token-overlap "meaning" check — enough of the answer's
  // significant words (or close misspellings of them) appear in the reply.
  const stop = new Set([
    "the", "a", "an", "of", "to", "and", "or", "in", "on", "is", "are",
    "with", "used", "for", "that", "this", "its", "his", "her", "their",
  ]);
  const correctTokens = b.split(" ").filter((t) => t.length > 2 && !stop.has(t));
  if (correctTokens.length === 0) return false;
  const typedTokens = a.split(" ").filter((t) => t.length > 2);
  let hits = 0;
  for (const t of correctTokens) {
    for (const tt of typedTokens) {
      if (tt === t || levenshtein(t, tt) <= Math.max(1, Math.floor(t.length * 0.25))) {
        hits++;
        break;
      }
    }
  }
  return hits / correctTokens.length >= 0.5;
}

export function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
