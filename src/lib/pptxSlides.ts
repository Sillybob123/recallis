// Renders a .pptx to slide images in the browser.
//
// A .pptx has no pre-rendered pictures — it's OOXML describing shapes, so we
// lay the slides out ourselves onto a canvas: placeholder/shape geometry from
// the slide (falling back to its layout and master), text runs with their real
// sizes and bullet indents, and embedded images. This covers ordinary lecture
// decks well; it is not a full PowerPoint engine (no charts, SmartArt,
// gradients or WordArt), which is why the UI also offers the PDF route for a
// pixel-perfect copy.

import JSZip from "jszip";

const EMU_PER_INCH = 914400;
const RENDER_DPI = 130;
const PX_PER_EMU = RENDER_DPI / EMU_PER_INCH;
const MAX_SLIDES = 200;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TextRun {
  text: string;
  sizePt?: number;
  bold: boolean;
  italic: boolean;
  color?: string;
}

interface Paragraph {
  runs: TextRun[];
  level: number;
  bullet: boolean;
  align: "l" | "ctr" | "r";
}

interface TextShape {
  kind: "text";
  box: Box;
  paragraphs: Paragraph[];
  /** title placeholders get larger default type */
  isTitle: boolean;
  anchor: "t" | "ctr" | "b";
}

interface PictureShape {
  /** the part of the source image PowerPoint shows, if it was cropped */
  crop?: SrcCrop;
  kind: "pic";
  box: Box;
  target: string;
}

type Shape = TextShape | PictureShape;

// ---------- tiny XML helpers (DOMParser is available in the browser) ----------

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}

/**
 * Element name without its namespace prefix. Namespace-aware parsers report
 * `localName` as "sp"; others hand back the raw "p:sp", so strip either way.
 */
function local(el: Element): string {
  const name = el.localName || el.nodeName;
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

function childrenNamed(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter((c) => local(c) === name);
}

function firstNamed(parent: Element, name: string): Element | null {
  for (const c of Array.from(parent.children)) {
    if (local(c) === name) return c;
  }
  return null;
}

/** All descendants with this local name, prefix-agnostic. */
function allDescendants(root: Document | Element, name: string): Element[] {
  const out: Element[] = [];
  const stack: Element[] = Array.from(
    (root as Element).children ?? (root as Document).documentElement.children
  );
  if ((root as Document).documentElement) {
    stack.unshift((root as Document).documentElement);
  }
  while (stack.length) {
    const el = stack.shift()!;
    if (local(el) === name) out.push(el);
    stack.push(...Array.from(el.children));
  }
  return out;
}

/** Depth-first search for the first descendant with this local name. */
function findDescendant(root: Element, name: string): Element | null {
  const stack = [...Array.from(root.children)];
  while (stack.length) {
    const el = stack.shift()!;
    if (local(el) === name) return el;
    stack.push(...Array.from(el.children));
  }
  return null;
}

/**
 * How a group maps its children onto the slide.
 *
 * A group's children are positioned in the group's own child coordinate space
 * (a:chOff / a:chExt), which is then mapped onto where the group itself sits
 * (a:off / a:ext). Reading a child's raw coordinates without applying that
 * puts grouped content wherever the group's designer happened to be working —
 * usually far off the slide, which is why grouped diagrams came out scattered
 * or missing entirely.
 */
interface GroupTransform {
  offX: number;
  offY: number;
  scaleX: number;
  scaleY: number;
  chOffX: number;
  chOffY: number;
}

function readGroupTransform(grpSpPr: Element | null): GroupTransform | null {
  if (!grpSpPr) return null;
  const xfrm = firstNamed(grpSpPr, "xfrm");
  if (!xfrm) return null;
  const off = firstNamed(xfrm, "off");
  const ext = firstNamed(xfrm, "ext");
  const chOff = firstNamed(xfrm, "chOff");
  const chExt = firstNamed(xfrm, "chExt");
  if (!off || !ext || !chOff || !chExt) return null;
  const chW = Number(chExt.getAttribute("cx") ?? 0);
  const chH = Number(chExt.getAttribute("cy") ?? 0);
  return {
    offX: Number(off.getAttribute("x") ?? 0),
    offY: Number(off.getAttribute("y") ?? 0),
    // A zero-sized child space would divide by zero; treat it as 1:1.
    scaleX: chW ? Number(ext.getAttribute("cx") ?? 0) / chW : 1,
    scaleY: chH ? Number(ext.getAttribute("cy") ?? 0) / chH : 1,
    chOffX: Number(chOff.getAttribute("x") ?? 0),
    chOffY: Number(chOff.getAttribute("y") ?? 0),
  };
}

/** Applies a chain of group transforms, innermost first. */
export function applyGroupTransforms(box: Box, chain: GroupTransform[]): Box {
  let out = box;
  for (let i = chain.length - 1; i >= 0; i--) {
    const t = chain[i];
    out = {
      x: t.offX + (out.x - t.chOffX) * t.scaleX,
      y: t.offY + (out.y - t.chOffY) * t.scaleY,
      w: out.w * t.scaleX,
      h: out.h * t.scaleY,
    };
  }
  return out;
}

/**
 * PowerPoint crops a picture by naming the fraction to cut off each edge
 * (a:srcRect, in 1000ths of a percent) while the shape box stays the visible
 * part. Ignoring it draws the whole image squeezed into the cropped box, which
 * is why cropped photos came out squashed and off-centre.
 */
export interface SrcCrop {
  l: number;
  t: number;
  r: number;
  b: number;
}

function readCrop(blipFill: Element | null): SrcCrop | undefined {
  if (!blipFill) return undefined;
  const src = firstNamed(blipFill, "srcRect");
  if (!src) return undefined;
  const pct = (name: string) => Number(src.getAttribute(name) ?? 0) / 100000;
  const crop = { l: pct("l"), t: pct("t"), r: pct("r"), b: pct("b") };
  if (!crop.l && !crop.t && !crop.r && !crop.b) return undefined;
  // A crop that removes everything would give a zero-width source rect.
  if (crop.l + crop.r >= 1 || crop.t + crop.b >= 1) return undefined;
  return crop;
}

function readBox(spPr: Element | null): Box | null {
  if (!spPr) return null;
  const xfrm = firstNamed(spPr, "xfrm");
  if (!xfrm) return null;
  const off = firstNamed(xfrm, "off");
  const ext = firstNamed(xfrm, "ext");
  if (!off || !ext) return null;
  return {
    x: Number(off.getAttribute("x") ?? 0),
    y: Number(off.getAttribute("y") ?? 0),
    w: Number(ext.getAttribute("cx") ?? 0),
    h: Number(ext.getAttribute("cy") ?? 0),
  };
}

/** Reads an r:-namespaced attribute regardless of how the parser exposes it. */
function relAttr(el: Element | null, name: string): string | null {
  if (!el) return null;
  return (
    el.getAttribute(`r:${name}`) ??
    el.getAttributeNS(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      name
    ) ??
    null
  );
}

function readColor(el: Element | null): string | undefined {
  if (!el) return undefined;
  const srgb = findDescendant(el, "srgbClr");
  if (srgb) {
    const v = srgb.getAttribute("val");
    if (v && /^[0-9a-f]{6}$/i.test(v)) return `#${v}`;
  }
  return undefined;
}

// ---------- relationship maps ----------

async function readRels(
  zip: JSZip,
  partPath: string
): Promise<Map<string, string>> {
  const dir = partPath.slice(0, partPath.lastIndexOf("/"));
  const relsPath = `${dir}/_rels/${partPath.slice(partPath.lastIndexOf("/") + 1)}.rels`;
  const file = zip.file(relsPath);
  const map = new Map<string, string>();
  if (!file) return map;
  const doc = parseXml(await file.async("string"));
  for (const rel of Array.from(doc.getElementsByTagName("Relationship"))) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (!id || !target) continue;
    map.set(id, resolvePath(dir, target));
  }
  return map;
}

function resolvePath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = baseDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

// ---------- shape extraction ----------

function placeholderInfo(sp: Element): { type: string; idx: string } | null {
  const nvSpPr = firstNamed(sp, "nvSpPr") ?? firstNamed(sp, "nvPicPr");
  if (!nvSpPr) return null;
  const nvPr = firstNamed(nvSpPr, "nvPr");
  if (!nvPr) return null;
  const ph = firstNamed(nvPr, "ph");
  if (!ph) return null;
  return {
    type: ph.getAttribute("type") ?? "body",
    idx: ph.getAttribute("idx") ?? "",
  };
}

function extractParagraphs(txBody: Element, defaultBold: boolean): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  for (const p of childrenNamed(txBody, "p")) {
    const pPr = firstNamed(p, "pPr");
    const level = Number(pPr?.getAttribute("lvl") ?? 0);
    const alignAttr = pPr?.getAttribute("algn");
    const align: Paragraph["align"] =
      alignAttr === "ctr" ? "ctr" : alignAttr === "r" ? "r" : "l";
    const noBullet = pPr ? Boolean(firstNamed(pPr, "buNone")) : false;

    const runs: TextRun[] = [];
    for (const child of Array.from(p.children)) {
      const name = local(child);
      if (name === "r") {
        const rPr = firstNamed(child, "rPr");
        const t = firstNamed(child, "t");
        const text = t?.textContent ?? "";
        if (!text) continue;
        const sz = rPr?.getAttribute("sz");
        runs.push({
          text,
          sizePt: sz ? Number(sz) / 100 : undefined,
          bold: rPr?.getAttribute("b") === "1" || defaultBold,
          italic: rPr?.getAttribute("i") === "1",
          color: readColor(rPr),
        });
      } else if (name === "br") {
        runs.push({ text: "\n", bold: false, italic: false });
      } else if (name === "fld") {
        const t = firstNamed(child, "t");
        if (t?.textContent) {
          runs.push({ text: t.textContent, bold: false, italic: false });
        }
      }
    }
    const hasText = runs.some((r) => r.text.trim());
    paragraphs.push({
      runs,
      level,
      bullet: hasText && !noBullet && level >= 0,
      align,
    });
  }
  return paragraphs;
}

function collectShapes(
  spTree: Element,
  rels: Map<string, string>,
  layoutBoxes: Map<string, Box>,
  isLayoutOrMaster: boolean
): Shape[] {
  const shapes: Shape[] = [];

  function walk(container: Element, chain: GroupTransform[]) {
    for (const el of Array.from(container.children)) {
      const name = local(el);
      if (name === "grpSp") {
        const t = readGroupTransform(firstNamed(el, "grpSpPr"));
        walk(el, t ? [...chain, t] : chain);
        continue;
      }
      if (name === "sp") {
        const ph = placeholderInfo(el);
        // Layout/master placeholders are prompts ("Click to add title"),
        // never real content — we only borrow their geometry.
        if (isLayoutOrMaster) continue;
        const txBody = firstNamed(el, "txBody");
        if (!txBody) continue;
        let box = readBox(firstNamed(el, "spPr"));
        if (!box && ph) {
          box =
            layoutBoxes.get(`${ph.type}:${ph.idx}`) ??
            layoutBoxes.get(`${ph.type}:`) ??
            layoutBoxes.get(`:${ph.idx}`) ??
            null;
        }
        if (!box) continue;
        box = applyGroupTransforms(box, chain);
        const isTitle = Boolean(ph && /title/i.test(ph.type));
        const paragraphs = extractParagraphs(txBody, false);
        if (!paragraphs.some((p) => p.runs.some((r) => r.text.trim()))) continue;
        const bodyPr = firstNamed(txBody, "bodyPr");
        const anchorAttr = bodyPr?.getAttribute("anchor");
        shapes.push({
          kind: "text",
          box,
          paragraphs,
          isTitle,
          anchor: anchorAttr === "ctr" ? "ctr" : anchorAttr === "b" ? "b" : "t",
        });
      } else if (name === "pic") {
        const box = readBox(firstNamed(el, "spPr"));
        const blipFill = firstNamed(el, "blipFill");
        const blip = blipFill ? findDescendant(blipFill, "blip") : null;
        const embed = relAttr(blip, "embed");
        if (!box || !embed) continue;
        const target = rels.get(embed);
        if (!target) continue;
        shapes.push({
          kind: "pic",
          box: applyGroupTransforms(box, chain),
          target,
          crop: readCrop(blipFill),
        });
      }
    }
  }

  walk(spTree, []);
  return shapes;
}

/** Placeholder geometry from a layout (and its master), keyed "type:idx". */
function collectPlaceholderBoxes(spTree: Element): Map<string, Box> {
  const boxes = new Map<string, Box>();
  function walk(container: Element, chain: GroupTransform[]) {
    for (const el of Array.from(container.children)) {
      const name = local(el);
      if (name === "grpSp") {
        const t = readGroupTransform(firstNamed(el, "grpSpPr"));
        walk(el, t ? [...chain, t] : chain);
        continue;
      }
      if (name !== "sp") continue;
      const ph = placeholderInfo(el);
      const raw = readBox(firstNamed(el, "spPr"));
      if (!ph || !raw) continue;
      const box = applyGroupTransforms(raw, chain);
      boxes.set(`${ph.type}:${ph.idx}`, box);
      if (!boxes.has(`${ph.type}:`)) boxes.set(`${ph.type}:`, box);
      if (ph.idx && !boxes.has(`:${ph.idx}`)) boxes.set(`:${ph.idx}`, box);
    }
  }
  walk(spTree, []);
  return boxes;
}

// ---------- drawing ----------

const BULLET_CHARS = ["•", "◦", "▪", "–"];

function wrapLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const attempt = `${line} ${words[i]}`;
    if (ctx.measureText(attempt).width <= maxWidth) {
      line = attempt;
    } else {
      lines.push(line);
      line = words[i];
    }
  }
  lines.push(line);
  return lines;
}

function drawTextShape(ctx: CanvasRenderingContext2D, shape: TextShape) {
  const x = shape.box.x * PX_PER_EMU;
  const y = shape.box.y * PX_PER_EMU;
  const w = Math.max(shape.box.w * PX_PER_EMU, 40);
  const h = Math.max(shape.box.h * PX_PER_EMU, 20);
  const padX = 6;

  // Measure everything first so vertical anchoring can be honored.
  type Line = {
    text: string;
    font: string;
    color: string;
    size: number;
    indent: number;
    align: Paragraph["align"];
    prefix?: string;
  };
  const lines: Line[] = [];

  for (const para of shape.paragraphs) {
    const first = para.runs.find((r) => r.text.trim());
    const sizePt =
      first?.sizePt ?? (shape.isTitle ? 34 : Math.max(20 - para.level * 2, 12));
    const sizePx = (sizePt * RENDER_DPI) / 72;
    const bold = shape.isTitle || Boolean(first?.bold);
    const italic = Boolean(first?.italic);
    const font = `${italic ? "italic " : ""}${bold ? "600 " : ""}${sizePx}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    const color = first?.color ?? (shape.isTitle ? "#14213d" : "#1f2937");
    const indent = para.bullet ? 14 + para.level * 20 : para.level * 20;

    const text = para.runs
      .map((r) => r.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) {
      lines.push({ text: "", font, color, size: sizePx, indent, align: para.align });
      continue;
    }

    ctx.font = font;
    const available = w - padX * 2 - indent;
    const wrapped = wrapLine(ctx, text, available);
    wrapped.forEach((lineText, i) => {
      lines.push({
        text: lineText,
        font,
        color,
        size: sizePx,
        indent,
        align: para.align,
        prefix:
          i === 0 && para.bullet && !shape.isTitle
            ? BULLET_CHARS[Math.min(para.level, BULLET_CHARS.length - 1)]
            : undefined,
      });
    });
  }

  const lineGap = 1.25;
  const totalHeight = lines.reduce((sum, l) => sum + l.size * lineGap, 0);
  let cursorY =
    shape.anchor === "ctr"
      ? y + Math.max((h - totalHeight) / 2, 0)
      : shape.anchor === "b"
        ? y + Math.max(h - totalHeight, 0)
        : y;

  ctx.textBaseline = "top";
  for (const line of lines) {
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    let drawX = x + padX + line.indent;
    if (line.align === "ctr") {
      drawX = x + (w - ctx.measureText(line.text).width) / 2;
    } else if (line.align === "r") {
      drawX = x + w - padX - ctx.measureText(line.text).width;
    }
    if (line.prefix) {
      ctx.fillText(line.prefix, drawX - 14, cursorY);
    }
    if (line.text) ctx.fillText(line.text, drawX, cursorY);
    cursorY += line.size * lineGap;
  }
}

async function loadImageBitmap(
  zip: JSZip,
  path: string
): Promise<ImageBitmap | null> {
  const file = zip.file(path);
  if (!file) return null;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  // Vector/legacy formats browsers can't decode (wmf/emf) are skipped.
  if (!["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"].includes(ext)) {
    return null;
  }
  try {
    const blob = await file.async("blob");
    const typed = new Blob([blob], {
      type:
        ext === "svg"
          ? "image/svg+xml"
          : ext === "jpg"
            ? "image/jpeg"
            : `image/${ext}`,
    });
    return await createImageBitmap(typed);
  } catch {
    return null;
  }
}

/**
 * Whether a slide holds things this renderer cannot draw: tables, charts and
 * SmartArt (all graphicFrame), connectors and arrows (cxnSp), and drawn shapes
 * whose point is their fill or outline rather than their text.
 *
 * Only undecodable *images* used to be counted, so a slide built out of boxes
 * and arrows came through as bare text on white with nothing said about it.
 */
function hasUndrawableContent(spTree: Element): boolean {
  const stack: Element[] = [spTree];
  while (stack.length) {
    const el = stack.pop()!;
    for (const child of Array.from(el.children)) {
      const name = local(child);
      if (name === "graphicFrame" || name === "cxnSp") return true;
      if (name === "sp") {
        const spPr = firstNamed(child, "spPr");
        if (spPr) {
          const filled =
            firstNamed(spPr, "solidFill") ??
            firstNamed(spPr, "gradFill") ??
            firstNamed(spPr, "blipFill") ??
            firstNamed(spPr, "pattFill");
          const outlined = firstNamed(spPr, "ln");
          // An outline element can still say "no line".
          const realOutline =
            outlined && !firstNamed(outlined, "noFill") ? outlined : null;
          if (filled || realOutline) return true;
        }
      }
      if (name === "grpSp" || name === "spTree") stack.push(child);
    }
  }
  return false;
}

/** Draws a picture, honouring any crop PowerPoint applied to it. */
function drawPicture(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  shape: PictureShape
) {
  const dx = shape.box.x * PX_PER_EMU;
  const dy = shape.box.y * PX_PER_EMU;
  const dw = shape.box.w * PX_PER_EMU;
  const dh = shape.box.h * PX_PER_EMU;
  const crop = shape.crop;
  if (!crop) {
    ctx.drawImage(bitmap, dx, dy, dw, dh);
    return;
  }
  const sx = bitmap.width * crop.l;
  const sy = bitmap.height * crop.t;
  const sw = bitmap.width * (1 - crop.l - crop.r);
  const sh = bitmap.height * (1 - crop.t - crop.b);
  ctx.drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh);
}

// ---------- public API ----------

export interface PptxRenderResult {
  slides: Blob[];
  /** Slides that referenced art we couldn't decode (wmf/emf, charts, …). */
  degradedCount: number;
}

export async function renderPptxToSlides(
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<PptxRenderResult> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const presFile = zip.file("ppt/presentation.xml");
  if (!presFile) {
    throw new Error("This doesn't look like a PowerPoint file.");
  }
  const presDoc = parseXml(await presFile.async("string"));
  const sldSz = allDescendants(presDoc, "sldSz")[0];
  const slideW = Number(sldSz?.getAttribute("cx") ?? 12192000);
  const slideH = Number(sldSz?.getAttribute("cy") ?? 6858000);

  // Slide order comes from presentation.xml's sldIdLst → relationship ids.
  const presRels = await readRels(zip, "ppt/presentation.xml");
  const slidePaths: string[] = [];
  const sldIdLst = allDescendants(presDoc, "sldIdLst")[0];
  if (sldIdLst) {
    for (const sldId of childrenNamed(sldIdLst, "sldId")) {
      const rid = relAttr(sldId, "id");
      const path = rid ? presRels.get(rid) : null;
      if (path) slidePaths.push(path);
    }
  }
  if (slidePaths.length === 0) {
    // Fall back to natural filename order.
    const names = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort(
        (a, b) =>
          Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1])
      );
    slidePaths.push(...names);
  }
  if (slidePaths.length === 0) {
    throw new Error("No slides found in this PowerPoint file.");
  }

  const total = Math.min(slidePaths.length, MAX_SLIDES);
  const canvasW = Math.round(slideW * PX_PER_EMU);
  const canvasH = Math.round(slideH * PX_PER_EMU);
  // Layouts are shared between slides, so parse each once — its placeholder
  // geometry and its template artwork both.
  const layoutCache = new Map<
    string,
    { boxes: Map<string, Box>; background: Shape[] }
  >();
  const blobs: Blob[] = [];
  let degradedCount = 0;

  for (let i = 0; i < total; i++) {
    const slidePath = slidePaths[i];
    const slideFile = zip.file(slidePath);
    if (!slideFile) continue;

    const slideDoc = parseXml(await slideFile.async("string"));
    const slideRels = await readRels(zip, slidePath);
    const spTree = allDescendants(slideDoc, "spTree")[0];

    // Placeholder geometry and template artwork: layout first, then master.
    let layoutBoxes = new Map<string, Box>();
    let background: Shape[] = [];
    const layoutPath = Array.from(slideRels.values()).find((t) =>
      t.includes("slideLayouts/")
    );
    if (layoutPath) {
      const cached = layoutCache.get(layoutPath);
      if (cached) {
        layoutBoxes = cached.boxes;
        background = cached.background;
      } else {
        const boxes = new Map<string, Box>();
        const art: Shape[] = [];
        const layoutFile = zip.file(layoutPath);
        if (layoutFile) {
          const layoutDoc = parseXml(await layoutFile.async("string"));
          const layoutTree = allDescendants(layoutDoc, "spTree")[0];
          const layoutRels = await readRels(zip, layoutPath);
          if (layoutTree) {
            for (const [k, v] of collectPlaceholderBoxes(layoutTree)) boxes.set(k, v);
          }

          const masterPath = Array.from(layoutRels.values()).find((t) =>
            t.includes("slideMasters/")
          );
          // A layout can opt out of the master's decoration entirely.
          const layoutEl = allDescendants(layoutDoc, "sldLayout")[0];
          const wantsMaster = layoutEl?.getAttribute("showMasterSp") !== "0";
          if (masterPath) {
            const masterFile = zip.file(masterPath);
            if (masterFile) {
              const masterDoc = parseXml(await masterFile.async("string"));
              const masterTree = allDescendants(masterDoc, "spTree")[0];
              const masterRels = await readRels(zip, masterPath);
              if (masterTree) {
                for (const [k, v] of collectPlaceholderBoxes(masterTree)) {
                  if (!boxes.has(k)) boxes.set(k, v);
                }
                // The master's own artwork sits behind everything else.
                if (wantsMaster) {
                  art.push(
                    ...collectShapes(masterTree, masterRels, boxes, true).filter(
                      (sh) => sh.kind === "pic"
                    )
                  );
                }
              }
            }
          }
          // Then the layout's, on top of the master's.
          if (layoutTree) {
            art.push(
              ...collectShapes(layoutTree, layoutRels, boxes, true).filter(
                (sh) => sh.kind === "pic"
              )
            );
          }
        }
        layoutBoxes = boxes;
        background = art;
        layoutCache.set(layoutPath, { boxes, background });
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasW, canvasH);

    // The deck's own template, underneath the slide's content.
    let missedArt = false;
    for (const shape of background) {
      if (shape.kind !== "pic") continue;
      const bitmap = await loadImageBitmap(zip, shape.target);
      if (!bitmap) continue;
      drawPicture(ctx, bitmap, shape);
      bitmap.close();
    }

    if (spTree && hasUndrawableContent(spTree)) missedArt = true;

    if (spTree) {
      const shapes = collectShapes(spTree, slideRels, layoutBoxes, false);
      // Pictures first so text lands on top of them.
      for (const shape of shapes) {
        if (shape.kind !== "pic") continue;
        const bitmap = await loadImageBitmap(zip, shape.target);
        if (!bitmap) {
          missedArt = true;
          continue;
        }
        drawPicture(ctx, bitmap, shape);
        bitmap.close();
      }
      for (const shape of shapes) {
        if (shape.kind === "text") drawTextShape(ctx, shape);
      }
    }
    if (missedArt) degradedCount++;

    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Slide render failed"))),
        "image/png"
      )
    );
    blobs.push(blob);
    onProgress?.(i + 1, total);
  }

  return { slides: blobs, degradedCount };
}
