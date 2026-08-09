// Anki note types usually style their own card background. We don't import
// that CSS — cards here are always light — so a deck written for a dark
// template arrives as neon text on white: "color: #00FF00" is 1.4:1 against
// white and effectively invisible.
//
// This darkens (or lightens) such colors just enough to be readable while
// keeping the hue and saturation, so a deck's colour coding still means what
// its author intended. Colors that are already legible are left untouched.

/** WCAG AA for body text. Below this, a colour gets adjusted. */
const TARGET_CONTRAST = 4.5;

/** The card background everything is measured against. */
const CARD_BG: RGB = { r: 255, g: 255, b: 255 };

interface RGB {
  r: number;
  g: number;
  b: number;
}

// Only the names likely to show up in a deck written for a dark template.
// Anything not listed is left alone rather than guessed at.
const NAMED: Record<string, string> = {
  white: "#ffffff",
  yellow: "#ffff00",
  lime: "#00ff00",
  aqua: "#00ffff",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  fuchsia: "#ff00ff",
  chartreuse: "#7fff00",
  springgreen: "#00ff7f",
  gold: "#ffd700",
  orange: "#ffa500",
  lightgreen: "#90ee90",
  lightblue: "#add8e6",
  lightcyan: "#e0ffff",
  lightyellow: "#ffffe0",
  lightpink: "#ffb6c1",
  lightgray: "#d3d3d3",
  lightgrey: "#d3d3d3",
  lavender: "#e6e6fa",
  ivory: "#fffff0",
  beige: "#f5f5dc",
  khaki: "#f0e68c",
  wheat: "#f5deb3",
  pink: "#ffc0cb",
  peachpuff: "#ffdab9",
  greenyellow: "#adff2f",
  palegreen: "#98fb98",
  aquamarine: "#7fffd4",
  turquoise: "#40e0d0",
  silver: "#c0c0c0",
  snow: "#fffafa",
  azure: "#f0ffff",
  honeydew: "#f0fff0",
  mintcream: "#f5fffa",
};

function parseColor(input: string): { rgb: RGB; alpha: number } | null {
  const value = input.trim().toLowerCase();
  if (!value || value === "inherit" || value === "currentcolor" || value === "transparent") {
    return null;
  }
  const named = NAMED[value];
  const text = named ?? value;

  const hex = text.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      return {
        rgb: {
          r: parseInt(h[0] + h[0], 16),
          g: parseInt(h[1] + h[1], 16),
          b: parseInt(h[2] + h[2], 16),
        },
        alpha: h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1,
      };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        rgb: {
          r: parseInt(h.slice(0, 2), 16),
          g: parseInt(h.slice(2, 4), 16),
          b: parseInt(h.slice(4, 6), 16),
        },
        alpha: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const fn = text.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (raw: string) =>
      raw.endsWith("%")
        ? Math.round((parseFloat(raw) / 100) * 255)
        : Math.round(parseFloat(raw));
    const rgb = {
      r: channel(parts[0]),
      g: channel(parts[1]),
      b: channel(parts[2]),
    };
    if ([rgb.r, rgb.g, rgb.b].some((n) => Number.isNaN(n))) return null;
    const alphaRaw = parts[3];
    const alpha = alphaRaw
      ? alphaRaw.endsWith("%")
        ? parseFloat(alphaRaw) / 100
        : parseFloat(alphaRaw)
      : 1;
    return { rgb, alpha: Number.isNaN(alpha) ? 1 : alpha };
  }
  return null;
}

function toHex({ r, g, b }: RGB): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`;
}

/** Flattens a translucent colour onto what sits behind it. */
function composite(fg: RGB, alpha: number, bg: RGB): RGB {
  if (alpha >= 0.999) return fg;
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
  };
}

function luminance({ r, g, b }: RGB): number {
  const channel = (n: number) => {
    const c = n / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function rgbToHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: channel(h + 1 / 3) * 255,
    g: channel(h) * 255,
    b: channel(h - 1 / 3) * 255,
  };
}

/**
 * Moves a colour's lightness toward whichever end contrasts with `bg`, hue and
 * saturation untouched, stopping as soon as it's readable. Returns null when
 * the colour is fine as it is.
 */
function makeReadable(color: RGB, bg: RGB): RGB | null {
  if (contrastRatio(color, bg) >= TARGET_CONTRAST) return null;
  const { h, s, l } = rgbToHsl(color);
  // Dark background wants a lighter colour, light background a darker one.
  const towardDark = luminance(bg) > 0.18;
  const steps = 50;
  for (let i = 1; i <= steps; i++) {
    const next = towardDark ? l * (1 - i / steps) : l + (1 - l) * (i / steps);
    const candidate = hslToRgb(h, s, next);
    if (contrastRatio(candidate, bg) >= TARGET_CONTRAST) return candidate;
  }
  return towardDark ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
}

const COLOR_DECL = /(^|;)\s*(color|background-color|background)\s*:\s*([^;!]+)(!important)?/gi;

/** Rewrites one inline style's colours. Returns null when nothing changed. */
function fixStyleAttribute(style: string): string | null {
  // The element's own background decides what its text is measured against;
  // a highlight chip is readable on itself even when it isn't on the card.
  let ownBg: RGB | null = null;
  for (const m of style.matchAll(COLOR_DECL)) {
    const prop = m[2].toLowerCase();
    if (prop === "color") continue;
    const parsed = parseColor(m[3]);
    if (parsed) ownBg = composite(parsed.rgb, parsed.alpha, CARD_BG);
  }

  let changed = false;
  const out = style.replace(
    COLOR_DECL,
    (full, lead: string, prop: string, value: string, bang: string | undefined) => {
      const parsed = parseColor(value);
      if (!parsed) return full;
      const isText = prop.toLowerCase() === "color";
      const flat = composite(parsed.rgb, parsed.alpha, CARD_BG);
      // Text is judged against its own background; a background is judged
      // against the text that will sit on it, which is the card's ink.
      const against = isText ? (ownBg ?? CARD_BG) : null;

      let fixed: RGB | null = null;
      if (isText) {
        fixed = makeReadable(flat, against!);
      } else {
        // Only rescue a background dark enough to swallow the card's text.
        const ink: RGB = { r: 26, g: 29, b: 41 };
        if (contrastRatio(flat, ink) < 3) fixed = makeReadable(flat, ink);
      }
      if (!fixed) return full;
      changed = true;
      return `${lead} ${prop}: ${toHex(fixed)}${bang ?? ""}`;
    }
  );
  return changed ? out : null;
}

const STYLE_ATTR = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/gi;
const FONT_COLOR = /(<font\b[^>]*?\bcolor\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>]+))/gi;

/**
 * Makes every inline colour in a fragment readable on a light card.
 * Untouched when nothing needs it, so the common case costs one scan.
 */
export function makeColorsReadable(html: string): string {
  if (!html || (!html.includes("color") && !html.includes("<font"))) return html;

  let out = html.replace(STYLE_ATTR, (full, dq: string | undefined, sq: string | undefined) => {
    const value = dq ?? sq ?? "";
    const fixed = fixStyleAttribute(value);
    if (fixed === null) return full;
    const quote = dq !== undefined ? '"' : "'";
    return `style=${quote}${fixed}${quote}`;
  });

  // <font color="lime"> is still all over older shared decks.
  out = out.replace(FONT_COLOR, (full, head: string, _raw, dq, sq, bare) => {
    const value = (dq ?? sq ?? bare ?? "") as string;
    const parsed = parseColor(value);
    if (!parsed) return full;
    const fixed = makeReadable(composite(parsed.rgb, parsed.alpha, CARD_BG), CARD_BG);
    if (!fixed) return full;
    return `${head}"${toHex(fixed)}"`;
  });

  return out;
}
