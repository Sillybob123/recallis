// Fitting a piece of text inside a box.
//
// A note on an occlusion card has to stay inside the rectangle you drew for
// it: spilling over the edge covers the anatomy underneath, which is the one
// thing a label must never do. So the text wraps, and the type size shrinks
// until the whole thing fits.
//
// The measuring is injected rather than assumed. The browser measures with a
// canvas context and so does the export, which is what makes the picture in
// the study view and the picture baked into an Anki card the same picture —
// and it means the algorithm itself can be tested without either.

export type MeasureText = (text: string, fontSize: number) => number;

export interface FitOptions {
  /** never smaller than this, in px */
  min?: number;
  /** never larger than this, in px */
  max?: number;
  /** multiple of the font size, so 1.25 leaves a quarter-line of air */
  lineHeight?: number;
  /** px of breathing room inside the box, on every side */
  padding?: number;
}

export interface FittedText {
  fontSize: number;
  lines: string[];
  lineHeight: number;
  /** true when even the smallest size didn't fit and the text is clipped */
  overflow: boolean;
}

const DEFAULTS = { min: 7, max: 44, lineHeight: 1.2, padding: 4 };

/**
 * Greedy word wrap: the usual algorithm, plus a hard break for a single
 * word wider than the line — a chemical name with no spaces in it would
 * otherwise stick out however small the type gets.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  measure: MeasureText
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, fontSize) <= maxWidth || !line) {
        // A word that doesn't fit on a line of its own is split.
        if (!line && measure(word, fontSize) > maxWidth) {
          let chunk = "";
          for (const ch of word) {
            if (chunk && measure(chunk + ch, fontSize) > maxWidth) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          line = chunk;
          continue;
        }
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

/**
 * The largest type size at which `text` fits inside the box.
 *
 * Found by bisection rather than by stepping down one pixel at a time: a
 * long note in a small box would otherwise measure the text thirty times
 * over, on every render.
 */
export function fitText(
  text: string,
  boxWidth: number,
  boxHeight: number,
  measure: MeasureText,
  options: FitOptions = {}
): FittedText {
  const { min, max, lineHeight, padding } = { ...DEFAULTS, ...options };
  const innerW = Math.max(boxWidth - padding * 2, 1);
  const innerH = Math.max(boxHeight - padding * 2, 1);
  const content = text.trim();
  if (!content) {
    return { fontSize: min, lines: [], lineHeight, overflow: false };
  }

  const fits = (size: number) => {
    const lines = wrapText(content, innerW, size, measure);
    return {
      lines,
      ok: lines.length * size * lineHeight <= innerH,
    };
  };

  // The box may be big enough for the text at full size; check before
  // bisecting so the common short-label case costs one measurement pass.
  const atMax = fits(max);
  if (atMax.ok) {
    return { fontSize: max, lines: atMax.lines, lineHeight, overflow: false };
  }

  let low = min;
  let high = max;
  let best = fits(min);
  let bestSize = min;
  // Half-pixel precision: finer than anyone can see, and bounded at about
  // seven passes over the range.
  while (high - low > 0.5) {
    const mid = (low + high) / 2;
    const attempt = fits(mid);
    if (attempt.ok) {
      best = attempt;
      bestSize = mid;
      low = mid;
    } else {
      high = mid;
    }
  }

  return {
    fontSize: bestSize,
    lines: best.lines,
    lineHeight,
    overflow: !best.ok,
  };
}

/**
 * A measurer backed by a canvas, shared by everything that draws in the
 * browser. One context is kept for the life of the page — creating one per
 * note per render was measurably worse than the measuring itself.
 */
export const FIT_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

let sharedCtx: CanvasRenderingContext2D | null = null;

export function canvasMeasure(weight = 700): MeasureText {
  return (text: string, fontSize: number) => {
    if (!sharedCtx) {
      const canvas = document.createElement("canvas");
      sharedCtx = canvas.getContext("2d");
    }
    if (!sharedCtx) return text.length * fontSize * 0.55;
    sharedCtx.font = `${weight} ${fontSize}px ${FIT_FONT_STACK}`;
    return sharedCtx.measureText(text).width;
  };
}
