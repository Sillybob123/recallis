// Anatomy mode: gloss the Latin and Greek behind anatomical vocabulary.
//
// The whole value here is trust. A reader who finds one confidently wrong
// gloss stops believing all of them, so this errs heavily toward saying
// nothing: a word is only marked when it is a known term outright, or when it
// splits cleanly and completely into known parts with at least one real root.
// Partial matches, single parts, and ordinary English are all refused.

import {
  PREFIXES,
  ROOTS,
  SUFFIXES,
  STOPWORDS,
  WHOLE_TERMS,
  type WordPart,
} from "./anatomyTerms";

export interface Gloss {
  word: string;
  /** the whole-word meaning, when it is a known term */
  whole?: string;
  /** the parts it breaks into, in order */
  parts: { form: string; meaning: string; origin: "L" | "Gk" }[];
}

/** Shortest word worth splitting. Below this, coincidences dominate. */
const MIN_LENGTH = 6;
/**
 * Endings that carry no meaning of their own but are how Latin and Greek
 * words arrive in English. Stripped before splitting, never glossed.
 */
const INFLECTIONS = [
  "ic", "ical", "al", "ar", "ary", "ous", "eal", "ine", "ian",
  "us", "um", "a", "ae", "i", "is", "es", "s", "e", "y",
];
/** Vowels that join two elements ("gastr-o-scopy"). */
const CONNECTORS = ["o", "i", "e", "a"];

function byLongest(parts: WordPart[]): WordPart[] {
  return [...parts].sort((a, b) => b.form.length - a.form.length);
}
const PREFIX_LIST = byLongest(PREFIXES);
const ROOT_LIST = byLongest(ROOTS);
const SUFFIX_LIST = byLongest(SUFFIXES);

interface Piece {
  form: string;
  meaning: string;
  origin: "L" | "Gk";
  isRoot: boolean;
}

/**
 * Splits a word into known elements, left to right, longest match first.
 * Returns null unless the entire word is accounted for.
 */
function split(word: string): Piece[] | null {
  const pieces: Piece[] = [];
  let rest = word;
  let guard = 0;

  while (rest.length > 0 && guard++ < 12) {
    // A suffix only counts when it finishes the word.
    const suffix = SUFFIX_LIST.find((p) => rest === p.form);
    if (suffix) {
      pieces.push({ ...suffix, isRoot: false });
      rest = "";
      break;
    }

    const pool = pieces.length === 0 ? [...PREFIX_LIST, ...ROOT_LIST] : ROOT_LIST;
    const match =
      pool.find((p) => rest.startsWith(p.form)) ??
      // A root may also end the word with a connecting vowel attached.
      null;
    if (match) {
      pieces.push({
        ...match,
        isRoot: ROOT_LIST.some((r) => r.form === match.form),
      });
      rest = rest.slice(match.form.length);
      // Swallow one connecting vowel between elements.
      if (rest.length > 1 && CONNECTORS.includes(rest[0])) {
        const after = rest.slice(1);
        const continues =
          ROOT_LIST.some((p) => after.startsWith(p.form)) ||
          SUFFIX_LIST.some((p) => after === p.form);
        if (continues) rest = after;
      }
      continue;
    }
    return null;
  }
  return rest.length === 0 ? pieces : null;
}

/** Strips one meaningless grammatical ending, longest first. */
function stripInflection(word: string): { stem: string; ending: string } {
  for (const ending of [...INFLECTIONS].sort((a, b) => b.length - a.length)) {
    if (word.length - ending.length >= 4 && word.endsWith(ending)) {
      return { stem: word.slice(0, -ending.length), ending };
    }
  }
  return { stem: word, ending: "" };
}

const cache = new Map<string, Gloss | null>();

/** The gloss for a single word, or null if nothing can be said confidently. */
export function glossWord(raw: string): Gloss | null {
  const word = raw.toLowerCase();
  const hit = cache.get(word);
  if (hit !== undefined) return hit;

  const result = computeGloss(word, raw);
  cache.set(word, result);
  return result;
}

function computeGloss(word: string, raw: string): Gloss | null {
  if (!/^[a-z]+$/.test(word)) return null;

  // Known terms win outright, and are the only case exempt from the
  // length and stopword rules — they were chosen deliberately.
  const whole = WHOLE_TERMS[word];
  if (whole) return { word: raw, whole, parts: [] };

  if (word.length < MIN_LENGTH) return null;
  if (STOPWORDS.has(word)) return null;
  // The stem too, so "intervenes" is refused along with "intervene".
  const { stem } = stripInflection(word);
  if (STOPWORDS.has(stem)) return null;

  for (const candidate of [word, stem]) {
    if (candidate.length < 4) continue;
    const pieces = split(candidate);
    if (!pieces) continue;
    // Two or more elements, at least one of them a real root: a lone prefix
    // plus an ending is how ordinary English gets caught by surprise.
    if (pieces.length < 2) continue;
    if (!pieces.some((p) => p.isRoot)) continue;
    return {
      word: raw,
      parts: pieces.map(({ form, meaning, origin }) => ({ form, meaning, origin })),
    };
  }
  return null;
}

/** One-line summary used as the tooltip text. */
export function glossText(gloss: Gloss): string {
  if (gloss.whole) return gloss.whole;
  return gloss.parts
    .map((p) => `${p.form}- ${p.meaning}`)
    .join("  +  ");
}

const WORD_RE = /[A-Za-z]+/g;
/** Tags whose text should be left completely alone. */
const SKIP_TAGS = new Set(["CODE", "PRE", "A", "SCRIPT", "STYLE", "ABBR", "KBD"]);

/**
 * Marks glossable words inside an element, in place. Only text nodes are
 * touched, so markup and cloze spans come through untouched.
 */
export function annotateAnatomy(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      for (let el: HTMLElement | null = parent; el && el !== root; el = el.parentElement) {
        if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
      }
      return /[A-Za-z]{6}/.test(node.nodeValue ?? "")
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });

  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) targets.push(n as Text);

  for (const node of targets) {
    const text = node.nodeValue ?? "";
    WORD_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    let cursor = 0;
    let frag: DocumentFragment | null = null;

    while ((match = WORD_RE.exec(text))) {
      const gloss = glossWord(match[0]);
      if (!gloss) continue;
      frag ??= document.createDocumentFragment();
      if (match.index > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, match.index)));
      }
      const mark = document.createElement("span");
      mark.className = "anat-term";
      mark.setAttribute("data-gloss", glossText(gloss));
      mark.textContent = match[0];
      frag.appendChild(mark);
      cursor = match.index + match[0].length;
    }

    if (frag) {
      if (cursor < text.length) {
        frag.appendChild(document.createTextNode(text.slice(cursor)));
      }
      node.parentNode?.replaceChild(frag, node);
    }
  }
}
