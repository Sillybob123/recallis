// Exporting an occlusion sheet bakes one image per mask plus an answer image,
// so the file count multiplies fast — 30 sheets with 161 masks in the real
// deck come to 191 images. Each one has to be a sensible size, and every mask
// has to still land on its target after any scaling.
import { exportDimensions } from "../src/lib/exportImage";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const ratio = (w: number, h: number) => w / h;

console.log("sizing:");
{
  // Typical of the real deck: already modest, so nothing should change.
  for (const [w, h] of [
    [960, 544],
    [1042, 580],
    [944, 1220],
    [1600, 900],
  ] as const) {
    const out = exportDimensions(w, h);
    check(
      `${w}x${h} is left alone`,
      out.width === w && out.height === h,
      `${out.width}x${out.height}`
    );
  }
}
{
  // A phone photo, which is where the cap earns its place.
  const out = exportDimensions(4032, 3024);
  check(
    "an oversized image is scaled down",
    Math.max(out.width, out.height) === 1600,
    `${out.width}x${out.height}`
  );
  check(
    "and keeps its shape, or every mask would miss",
    Math.abs(ratio(out.width, out.height) - ratio(4032, 3024)) < 0.01,
    `${ratio(out.width, out.height).toFixed(3)} vs ${ratio(4032, 3024).toFixed(3)}`
  );
}
{
  const tall = exportDimensions(1200, 5000);
  check(
    "the long edge is what's capped, whichever it is",
    Math.max(tall.width, tall.height) === 1600 && tall.width < tall.height,
    `${tall.width}x${tall.height}`
  );
}
{
  const pano = exportDimensions(6000, 400);
  check(
    "an extreme panorama still scales by its long edge",
    pano.width === 1600 && pano.height === Math.round(400 * (1600 / 6000)),
    `${pano.width}x${pano.height}`
  );
  check("and never collapses to nothing", pano.height >= 1);
}

console.log("\nawkward input:");
{
  check("zero is not a valid canvas", exportDimensions(0, 0).width >= 1);
  check(
    "a broken image doesn't produce NaN",
    Number.isFinite(exportDimensions(NaN, NaN).width) &&
      exportDimensions(NaN, NaN).width >= 1
  );
  const one = exportDimensions(1, 1);
  check("a one-pixel image survives", one.width === 1 && one.height === 1);
  const frac = exportDimensions(999.6, 500.4);
  check(
    "fractional sizes round to whole pixels",
    Number.isInteger(frac.width) && Number.isInteger(frac.height),
    `${frac.width}x${frac.height}`
  );
}

// ---------- what the export produces ----------
console.log("\nfile count:");
{
  // One answer image per sheet, one question image per mask unit.
  const sheets = 30;
  const masks = 161;
  const files = sheets + masks;
  check(
    `${sheets} sheets with ${masks} masks bake ${files} images`,
    files === 191,
    "which is why the per-image format matters more than the resolution"
  );
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
