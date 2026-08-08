// Node harness for the pptx slide parser. linkedom supplies DOMParser and a
// stub canvas so the shape-extraction path can be exercised outside a browser.
import { readFileSync } from "node:fs";
import { DOMParser } from "linkedom";
(globalThis as any).DOMParser = DOMParser;

const captured: any[] = [];
(globalThis as any).document = {
  createElement: (tag: string) => {
    if (tag !== "canvas") throw new Error("unexpected " + tag);
    const ops: any[] = [];
    return {
      width: 0, height: 0,
      getContext: () => ({
        set font(v: string) { ops.push(["font", v]); },
        set fillStyle(v: string) {},
        set textBaseline(v: string) {},
        fillRect: () => {},
        drawImage: (...a: any[]) => ops.push(["img", a[3], a[4]]),
        fillText: (t: string, x: number, y: number) => ops.push(["text", t, Math.round(x), Math.round(y)]),
        measureText: (t: string) => ({ width: t.length * 7 }),
      }),
      toBlob: (cb: any) => { captured.push(ops); cb(new Blob(["x"])); },
    };
  },
};
(globalThis as any).createImageBitmap = async () => ({ width: 10, height: 10, close() {} });

const { renderPptxToSlides } = await import("../src/lib/pptxSlides");

for (const path of [
  "/Users/yairben-dor/My Computer/Downloads/06 Calibration Methods.pptx",
  "/Users/yairben-dor/XCode/FunProject/Judaisim PPTX.pptx",
]) {
  captured.length = 0;
  const buf = readFileSync(path);
  const file = new File([buf], path.split("/").pop()!);
  const res = await renderPptxToSlides(file);
  console.log("\n=== " + path.split("/").pop());
  console.log("slides rendered:", res.slides.length, "| degraded:", res.degradedCount);
  for (const idx of [1, 2]) {
    const ops = captured[idx] ?? [];
    const texts = ops.filter((o: any) => o[0] === "text").map((o: any) => o[1]);
    const imgs = ops.filter((o: any) => o[0] === "img").length;
    console.log(`  slide ${idx + 1}: ${texts.length} text lines, ${imgs} images`);
    console.log("    " + JSON.stringify(texts.slice(0, 5)));
  }
}

// Confirm embedded pictures are found and drawn
{
  captured.length = 0;
  const path = "/Users/yairben-dor/My Computer/Downloads/06 Calibration Methods.pptx";
  const res = await renderPptxToSlides(new File([readFileSync(path)], "x.pptx"));
  let slidesWithImages = 0, totalImages = 0;
  captured.forEach((ops) => {
    const n = ops.filter((o: any) => o[0] === "img").length;
    if (n) { slidesWithImages++; totalImages += n; }
  });
  console.log(`\nimages: ${totalImages} drawn across ${slidesWithImages} slides (degraded=${res.degradedCount})`);
}
