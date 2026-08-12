import type { OcclusionShape, ShapeKind } from "../types";

export const DEFAULT_MASK_COLOR = "#2f6feb";

export function shapeKind(s: OcclusionShape): ShapeKind {
  return s.kind ?? "rect";
}

export const ANNOTATION_KINDS: ShapeKind[] = ["note", "arrow", "star"];

/** The colour annotations get unless you pick another: made to be noticed. */
export const DEFAULT_ANNOTATION_COLOR = "#e11d48";

/**
 * Whether this marks the image up rather than covering something on it.
 *
 * Everything downstream keys off this: annotations never become cards, are
 * never hidden during study, and bake into both sides of an export. The flag
 * is checked as well as the kind so that a sheet written by a newer version
 * degrades safely rather than turning an arrow into a question.
 */
export function isAnnotation(s: OcclusionShape): boolean {
  return s.annotation === true || ANNOTATION_KINDS.includes(shapeKind(s));
}

/**
 * A cover hides something for good: it is drawn on every side of every card
 * and never becomes a question of its own. That is what makes it useful for
 * a spoiler printed on the slide.
 */
export function isCover(s: OcclusionShape): boolean {
  return s.cover === true;
}

/** Whether this shape is asked as a question. Covers and marks are not. */
export function isCardShape(s: OcclusionShape): boolean {
  return !isAnnotation(s) && !isCover(s);
}

export function coversOf(shapes: OcclusionShape[]): OcclusionShape[] {
  return shapes.filter(isCover);
}

/** The shapes that actually cover something up. */
export function masksOf(shapes: OcclusionShape[]): OcclusionShape[] {
  return shapes.filter((s) => !isAnnotation(s));
}

export function annotationsOf(shapes: OcclusionShape[]): OcclusionShape[] {
  return shapes.filter(isAnnotation);
}

export function shapeColor(s: OcclusionShape): string {
  return s.color ?? DEFAULT_MASK_COLOR;
}

export function shapeOpacity(s: OcclusionShape): number {
  return s.opacity ?? 1;
}

/** Do two normalized boxes overlap at all? Used by the marquee selection. */
export function boxesIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Recomputes a polygon's bounding box from its points. */
export function polygonBounds(points: { x: number; y: number }[]) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: Math.max(maxX - minX, 0), h: Math.max(maxY - minY, 0) };
}

export function translateShape(s: OcclusionShape, dx: number, dy: number): OcclusionShape {
  // Clamp so the whole shape stays inside the image.
  const nx = Math.min(Math.max(s.x + dx, 0), 1 - s.w);
  const ny = Math.min(Math.max(s.y + dy, 0), 1 - s.h);
  const adx = nx - s.x;
  const ady = ny - s.y;
  const moved: OcclusionShape = { ...s, x: nx, y: ny };
  if (s.points) {
    moved.points = s.points.map((p) => ({ x: p.x + adx, y: p.y + ady }));
  }
  return moved;
}

/**
 * Groups shapes into study "units": all shapes sharing a groupId form one
 * unit (hidden/revealed together, one card); ungrouped shapes are single
 * units. Unit label = first non-empty member label.
 */
export interface ShapeUnit {
  key: string;
  shapeIds: string[];
  label?: string;
}

/**
 * One study card per mask or mask group, in the order the masks appear on the
 * image. Order matters beyond aesthetics: imported Anki schedules are matched
 * to units positionally, so grouped masks must not be shuffled to the end.
 */
export function buildUnits(shapes: OcclusionShape[]): ShapeUnit[] {
  const units: ShapeUnit[] = [];
  const groupSlot = new Map<string, number>();
  for (const s of shapes) {
    // An arrow pointing at something is not a question about it, and a
    // cover exists precisely so that it is never asked.
    if (!isCardShape(s)) continue;
    if (s.groupId) {
      const existing = groupSlot.get(s.groupId);
      if (existing === undefined) {
        groupSlot.set(s.groupId, units.length);
        units.push({
          key: `g:${s.groupId}`,
          shapeIds: [s.id],
          label: s.label || undefined,
        });
      } else {
        const unit = units[existing];
        unit.shapeIds.push(s.id);
        if (!unit.label && s.label) unit.label = s.label;
      }
    } else {
      units.push({ key: s.id, shapeIds: [s.id], label: s.label || undefined });
    }
  }
  return units;
}

/**
 * The five points of a star inscribed in a shape's box, as normalized
 * coordinates. Shared so the editor, the study overlay and the export all
 * draw the identical star rather than three near-misses.
 */
export function starPoints(s: OcclusionShape): { x: number; y: number }[] {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const rx = s.w / 2;
  const ry = s.h / 2;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 10; i++) {
    // Start at the top point, then alternate outer and inner radius.
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const scale = i % 2 === 0 ? 1 : 0.42;
    pts.push({ x: cx + Math.cos(angle) * rx * scale, y: cy + Math.sin(angle) * ry * scale });
  }
  return pts;
}

/** Tail and head of an arrow: its points if set, else its box diagonal. */
export function arrowEnds(s: OcclusionShape): {
  from: { x: number; y: number };
  to: { x: number; y: number };
} {
  if (s.points && s.points.length >= 2) {
    return { from: s.points[0], to: s.points[s.points.length - 1] };
  }
  return { from: { x: s.x, y: s.y }, to: { x: s.x + s.w, y: s.y + s.h } };
}

/** Stroke width for an annotation, as a fraction of the image width. */
export function annotationWeight(s: OcclusionShape): number {
  return s.weight ?? 0.006;
}

/**
 * The two barbs of an arrowhead, sized against the shaft so a short arrow
 * doesn't end in a head bigger than itself.
 */
export function arrowHead(
  from: { x: number; y: number },
  to: { x: number; y: number },
  weight: number
): { x: number; y: number }[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const size = Math.min(weight * 4.5, len * 0.4);
  const angle = Math.atan2(dy, dx);
  const spread = Math.PI / 7;
  return [
    { x: to.x - Math.cos(angle - spread) * size, y: to.y - Math.sin(angle - spread) * size },
    to,
    { x: to.x - Math.cos(angle + spread) * size, y: to.y - Math.sin(angle + spread) * size },
  ];
}

/** Fills a shape onto a canvas whose size is the full image, in pixels. */
/**
 * Draws an annotation onto the export canvas. Annotations are part of the
 * picture rather than the question, so they go onto both the masked and the
 * revealed image.
 */
export function drawAnnotationOnCanvas(
  ctx: CanvasRenderingContext2D,
  s: OcclusionShape,
  W: number,
  H: number
) {
  const color = s.color ?? DEFAULT_ANNOTATION_COLOR;
  const kind = shapeKind(s);
  const lineWidth = Math.max(annotationWeight(s) * W, 1.5);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (kind === "arrow") {
    const { from, to } = arrowEnds(s);
    ctx.beginPath();
    ctx.moveTo(from.x * W, from.y * H);
    ctx.lineTo(to.x * W, to.y * H);
    ctx.stroke();
    const head = arrowHead(from, to, annotationWeight(s));
    ctx.beginPath();
    ctx.moveTo(head[0].x * W, head[0].y * H);
    ctx.lineTo(head[1].x * W, head[1].y * H);
    ctx.lineTo(head[2].x * W, head[2].y * H);
    ctx.closePath();
    ctx.fill();
  } else if (kind === "star") {
    const pts = starPoints(s);
    ctx.beginPath();
    ctx.moveTo(pts[0].x * W, pts[0].y * H);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * W, pts[i].y * H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = Math.max(lineWidth * 0.35, 1);
    ctx.stroke();
  } else if (kind === "note") {
    const text = (s.label ?? "").trim();
    if (text) {
      const size = Math.max(s.h * H * 0.72, 12);
      ctx.font = `700 ${size}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      const metrics = ctx.measureText(text);
      const padX = size * 0.4;
      const padY = size * 0.28;
      const boxW = metrics.width + padX * 2;
      const boxH = size + padY * 2;
      const x = s.x * W;
      const y = s.y * H;
      // A plate behind the text, because a label that lands on a pale part
      // of an anatomy plate is unreadable without one.
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.beginPath();
      ctx.roundRect?.(x, y, boxW, boxH, size * 0.3);
      if (!ctx.roundRect) ctx.rect(x, y, boxW, boxH);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(size * 0.06, 1);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textBaseline = "top";
      ctx.fillText(text, x + padX, y + padY);
    }
  }
  ctx.restore();
}

export function fillShapeOnCanvas(
  ctx: CanvasRenderingContext2D,
  s: OcclusionShape,
  W: number,
  H: number,
  colorOverride?: string
) {
  ctx.fillStyle = colorOverride ?? shapeColor(s);
  const kind = shapeKind(s);
  if (kind === "rect") {
    ctx.fillRect(s.x * W, s.y * H, s.w * W, s.h * H);
  } else if (kind === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(
      (s.x + s.w / 2) * W,
      (s.y + s.h / 2) * H,
      (s.w / 2) * W,
      (s.h / 2) * H,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
  } else if (kind === "polygon" && s.points && s.points.length >= 3) {
    ctx.beginPath();
    ctx.moveTo(s.points[0].x * W, s.points[0].y * H);
    for (let i = 1; i < s.points.length; i++) {
      ctx.lineTo(s.points[i].x * W, s.points[i].y * H);
    }
    ctx.closePath();
    ctx.fill();
  }
}
