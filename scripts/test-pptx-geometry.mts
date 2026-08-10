// A grouped shape in PowerPoint is positioned in the group's own child
// coordinate space, which is then mapped onto where the group sits. Reading a
// child's raw numbers puts it wherever the designer happened to be working —
// often far off the slide, which is what "cropped and broken" looked like.
import { applyGroupTransforms } from "../src/lib/pptxSlides";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

// A 16:9 slide is 12192000 x 6858000 EMU.
const SLIDE_W = 12192000;
const SLIDE_H = 6858000;

console.log("no groups:");
{
  const box = { x: 100, y: 200, w: 300, h: 400 };
  const out = applyGroupTransforms(box, []);
  check("an ungrouped shape is untouched", JSON.stringify(out) === JSON.stringify(box));
}

console.log("\none group:");
{
  // A group sitting at (1000000, 500000), 2000000 x 1000000 on the slide,
  // whose children were authored in a space of the same size at the origin.
  const group = {
    offX: 1000000, offY: 500000,
    scaleX: 1, scaleY: 1,
    chOffX: 0, chOffY: 0,
  };
  const child = { x: 0, y: 0, w: 500000, h: 250000 };
  const out = applyGroupTransforms(child, [group]);
  check(
    "a child at the group's origin lands at the group",
    out.x === 1000000 && out.y === 500000,
    `(${out.x}, ${out.y})`
  );
  check("and keeps its size at 1:1", out.w === 500000 && out.h === 250000);
}
{
  // The usual real case: the child space is offset and a different size, so
  // the group both moves and scales what's inside it.
  const group = {
    offX: 2000000, offY: 1000000,
    scaleX: 0.5, scaleY: 0.5,
    chOffX: 4000000, chOffY: 3000000,
  };
  const child = { x: 4000000, y: 3000000, w: 800000, h: 600000 };
  const out = applyGroupTransforms(child, [group]);
  check(
    "the child origin maps onto the group origin",
    out.x === 2000000 && out.y === 1000000,
    `(${out.x}, ${out.y})`
  );
  check("and the child is scaled with the group", out.w === 400000 && out.h === 300000);
}
{
  // Without the transform this is the disaster case: a child authored far from
  // the origin ends up way off the slide.
  const group = {
    offX: 500000, offY: 500000,
    scaleX: 1, scaleY: 1,
    chOffX: 9000000, chOffY: 5000000,
  };
  const child = { x: 9100000, y: 5100000, w: 200000, h: 200000 };
  const raw = child;
  const out = applyGroupTransforms(child, [group]);
  check(
    "raw coordinates would land off the slide",
    raw.x > SLIDE_W * 0.7 && raw.y > SLIDE_H * 0.7,
    "which is the bug being fixed"
  );
  check(
    "the transform brings it back on-slide",
    out.x === 600000 && out.y === 600000 && out.x < SLIDE_W && out.y < SLIDE_H,
    `(${out.x}, ${out.y})`
  );
}

console.log("\nnested groups:");
{
  const outer = {
    offX: 1000000, offY: 1000000,
    scaleX: 2, scaleY: 2,
    chOffX: 0, chOffY: 0,
  };
  const inner = {
    offX: 100000, offY: 100000,
    scaleX: 0.5, scaleY: 0.5,
    chOffX: 0, chOffY: 0,
  };
  const child = { x: 200000, y: 200000, w: 100000, h: 100000 };
  const out = applyGroupTransforms(child, [outer, inner]);
  // inner: 100000 + 200000*0.5 = 200000 ; outer: 1000000 + 200000*2 = 1400000
  check(
    "transforms compose innermost-first",
    out.x === 1400000 && out.y === 1400000,
    `(${out.x}, ${out.y})`
  );
  check("and so do the scales", out.w === 100000 && out.h === 100000,
    `0.5 * 2 = 1, so the size is unchanged`);
}

console.log("\nawkward files:");
{
  // A degenerate child space would divide by zero; the reader substitutes 1:1.
  const group = { offX: 0, offY: 0, scaleX: 1, scaleY: 1, chOffX: 0, chOffY: 0 };
  const out = applyGroupTransforms({ x: 5, y: 5, w: 5, h: 5 }, [group]);
  check("a 1:1 group is a no-op", out.x === 5 && out.w === 5);
}
{
  // Groups are often stretched unevenly.
  const group = {
    offX: 0, offY: 0,
    scaleX: 3, scaleY: 0.25,
    chOffX: 0, chOffY: 0,
  };
  const out = applyGroupTransforms({ x: 100, y: 100, w: 100, h: 100 }, [group]);
  check(
    "each axis scales independently",
    near(out.x, 300) && near(out.y, 25) && near(out.w, 300) && near(out.h, 25),
    `x${out.x} y${out.y} w${out.w} h${out.h}`
  );
}

// ---------- image cropping ----------
// srcRect names the fraction cut from each edge; the visible part is what
// gets drawn into the shape box.
console.log("\nimage crop:");
{
  const source = (w: number, h: number, crop: { l: number; t: number; r: number; b: number }) => ({
    sx: w * crop.l,
    sy: h * crop.t,
    sw: w * (1 - crop.l - crop.r),
    sh: h * (1 - crop.t - crop.b),
  });
  const full = source(1000, 800, { l: 0, t: 0, r: 0, b: 0 });
  check("no crop uses the whole image", full.sx === 0 && full.sw === 1000 && full.sh === 800);

  const half = source(1000, 800, { l: 0.25, t: 0, r: 0.25, b: 0 });
  check(
    "a symmetric crop takes the middle",
    half.sx === 250 && half.sw === 500,
    `x${half.sx} w${half.sw}`
  );

  const topLeft = source(1000, 800, { l: 0.1, t: 0.2, r: 0, b: 0 });
  check(
    "an asymmetric crop starts where it should",
    topLeft.sx === 100 && topLeft.sy === 160 && topLeft.sw === 900 && topLeft.sh === 640
  );
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
