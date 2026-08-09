// Colours written for a dark Anki template have to survive the move to a
// light card. Bright text must darken; already-readable text must not move.
import {
  contrastRatio,
  makeColorsReadable,
} from "../src/lib/readableColor";

const WHITE = { r: 255, g: 255, b: 255 };

function hexToRgb(hex: string) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function hueOf({ r, g, b }: { r: number; g: number; b: number }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return -1;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return h;
}

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// --- bright colours must become readable, keeping their hue ---
const bright = [
  ["neon green", "#00ff00"],
  ["yellow", "#ffff00"],
  ["cyan", "#00ffff"],
  ["lime keyword", "lime"],
  ["light pink", "#ffb6c1"],
  ["gold", "gold"],
  ["rgb() form", "rgb(0, 255, 128)"],
];
console.log("brightened text on a white card:");
for (const [name, value] of bright) {
  const out = makeColorsReadable(`<span style="color: ${value}">word</span>`);
  const hex = out.match(/color:\s*(#[0-9a-f]{6})/i)?.[1];
  if (!hex) {
    check(name, false, `no colour in ${out}`);
    continue;
  }
  const ratio = contrastRatio(hexToRgb(hex), WHITE);
  const before = value.startsWith("#") || value.startsWith("rgb") ? value : value;
  check(
    `${name} (${before} → ${hex})`,
    ratio >= 4.5,
    `contrast ${ratio.toFixed(2)}:1`
  );
}

// hue preserved: green stays green
{
  const out = makeColorsReadable(`<span style="color:#00ff00">x</span>`);
  const hex = out.match(/#[0-9a-f]{6}/i)![0];
  const dh = Math.abs(hueOf(hexToRgb(hex)) - hueOf(hexToRgb("#00ff00")));
  check("hue preserved for neon green", dh < 0.02, `Δhue ${dh.toFixed(4)}`);
}

// --- readable colours must be left exactly as they were ---
console.log("\nleft alone:");
for (const [name, value] of [
  ["dark red", "#8b0000"],
  ["navy", "#001f5b"],
  ["slate body text", "rgb(26,29,41)"],
  ["mid blue", "#1d4ed8"],
]) {
  const input = `<span style="color: ${value}">word</span>`;
  check(`${name} (${value})`, makeColorsReadable(input) === input);
}

// --- text on its own dark background is already readable ---
{
  const input = `<span style="background-color:#000000; color:#00ff00">x</span>`;
  const out = makeColorsReadable(input);
  const colors = [...out.matchAll(/(?:^|[;"'\s])color:\s*([^;"']+)/gi)].map((m) =>
    m[1].trim()
  );
  check(
    "neon on its own black chip is kept",
    colors.some((c) => c.toLowerCase() === "#00ff00"),
    `got ${JSON.stringify(colors)}`
  );
}

// --- <font color> still used by older shared decks ---
{
  const out = makeColorsReadable(`<font color="lime">word</font>`);
  const hex = out.match(/#[0-9a-f]{6}/i)?.[1] ?? out.match(/#[0-9a-f]{6}/i)?.[0];
  check(
    "<font color=lime> darkened",
    !!hex && contrastRatio(hexToRgb(hex!), WHITE) >= 4.5,
    out
  );
}
{
  const input = `<font color="#8b0000">word</font>`;
  check("<font color> readable is untouched", makeColorsReadable(input) === input);
}

// --- structure and unrelated declarations survive ---
{
  const out = makeColorsReadable(
    `<span style="font-weight:bold; color:#00ff00; font-size:14px">x</span>`
  );
  check(
    "other declarations survive",
    out.includes("font-weight:bold") && out.includes("font-size:14px"),
    out
  );
}
{
  const input = `<div>no colours here at all</div>`;
  check("untouched when there is nothing to fix", makeColorsReadable(input) === input);
}
{
  const out = makeColorsReadable(`<span style="color:#00ff00 !important">x</span>`);
  check("!important is preserved", out.includes("!important"), out);
}

// --- a dark highlight background gets lightened so card ink shows ---
{
  const out = makeColorsReadable(`<span style="background-color:#001100">x</span>`);
  const hex = out.match(/background-color:\s*(#[0-9a-f]{6})/i)?.[1];
  const ink = { r: 26, g: 29, b: 41 };
  check(
    "near-black highlight lightened",
    !!hex && contrastRatio(hexToRgb(hex!), ink) >= 4.5,
    `→ ${hex}`
  );
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
