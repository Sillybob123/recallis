import type { OcclusionShape } from "../types";

export const DEFAULT_MASK_COLOR = "#2f6feb";

export function shapeKind(s: OcclusionShape): "rect" | "ellipse" | "polygon" {
  return s.kind ?? "rect";
}

export function shapeColor(s: OcclusionShape): string {
  return s.color ?? DEFAULT_MASK_COLOR;
}

export function shapeOpacity(s: OcclusionShape): number {
  return s.opacity ?? 1;
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

export function buildUnits(shapes: OcclusionShape[]): ShapeUnit[] {
  const units: ShapeUnit[] = [];
  const grouped = new Map<string, OcclusionShape[]>();
  for (const s of shapes) {
    if (s.groupId) {
      const list = grouped.get(s.groupId) ?? [];
      list.push(s);
      grouped.set(s.groupId, list);
    } else {
      units.push({ key: s.id, shapeIds: [s.id], label: s.label || undefined });
    }
  }
  for (const [gid, members] of grouped) {
    units.push({
      key: `g:${gid}`,
      shapeIds: members.map((m) => m.id),
      label: members.find((m) => m.label)?.label,
    });
  }
  return units;
}

/** Fills a shape onto a canvas whose size is the full image, in pixels. */
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
