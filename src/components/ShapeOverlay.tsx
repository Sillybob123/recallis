import type { OcclusionShape } from "../types";
import {
  annotationWeight,
  arrowEnds,
  arrowHead,
  DEFAULT_ANNOTATION_COLOR,
  isAnnotation,
  shapeColor,
  shapeKind,
  shapeOpacity,
  starPoints,
} from "../lib/shapes";

const TARGET_COLOR = "#f59e0b";

/**
 * Display-only SVG overlay for study views. Absolutely position over the
 * image. Shapes in `hiddenIds` are drawn filled; shapes in `targetIds` are
 * drawn in amber. When `outlineIds` is given, those shapes are drawn as
 * dashed outlines (the answer view showing exactly what was covered).
 */
export function ShapeOverlay({
  shapes,
  hiddenIds,
  targetIds,
  outlineIds,
}: {
  shapes: OcclusionShape[];
  hiddenIds: Set<string>;
  targetIds: Set<string>;
  outlineIds?: Set<string>;
}) {
  // Text-box masks display their prompt while covered — HTML, not SVG <text>,
  // because the stretched 0-100 viewBox would distort glyphs.
  const prompts = shapes.filter(
    (s) =>
      !isAnnotation(s) &&
      s.textPrompt &&
      s.label &&
      hiddenIds.has(s.id) &&
      !outlineIds?.has(s.id)
  );
  // Annotations mark the image up rather than covering it, so they are drawn
  // on every side of every card — question and answer alike.
  const notes = shapes.filter((s) => shapeKind(s) === "note" && s.label);
  return (
    <div className="pointer-events-none absolute inset-0">
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {shapes.map((s) => {
        if (isAnnotation(s)) return <Annotation key={s.id} shape={s} />;
        const hidden = hiddenIds.has(s.id);
        const outlined = outlineIds?.has(s.id) ?? false;
        if (!hidden && !outlined) return null;
        const isTarget = targetIds.has(s.id);
        const common = outlined
          ? {
              fill: "none",
              stroke: TARGET_COLOR,
              strokeWidth: 2,
              strokeDasharray: "4 3",
              vectorEffect: "non-scaling-stroke" as const,
            }
          : {
              fill: isTarget ? TARGET_COLOR : shapeColor(s),
              fillOpacity: isTarget ? 1 : shapeOpacity(s),
              stroke: "rgba(255,255,255,0.65)",
              strokeWidth: 1,
              vectorEffect: "non-scaling-stroke" as const,
            };
        const kind = shapeKind(s);
        if (kind === "ellipse") {
          return (
            <ellipse
              key={s.id}
              cx={(s.x + s.w / 2) * 100}
              cy={(s.y + s.h / 2) * 100}
              rx={(s.w / 2) * 100}
              ry={(s.h / 2) * 100}
              {...common}
            />
          );
        }
        if (kind === "polygon" && s.points && s.points.length >= 3) {
          return (
            <polygon
              key={s.id}
              points={s.points.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
              {...common}
            />
          );
        }
        return (
          <rect
            key={s.id}
            x={s.x * 100}
            y={s.y * 100}
            width={s.w * 100}
            height={s.h * 100}
            {...common}
          />
        );
      })}
    </svg>
    {notes.map((s) => (
      <span
        key={`note-${s.id}`}
        className="absolute flex items-center rounded-md px-1.5 font-bold leading-tight"
        style={{
          left: `${s.x * 100}%`,
          top: `${s.y * 100}%`,
          height: `${s.h * 100}%`,
          maxWidth: `${(1 - s.x) * 100}%`,
          color: s.color ?? DEFAULT_ANNOTATION_COLOR,
          background: "rgba(255,255,255,0.92)",
          border: `1px solid ${s.color ?? DEFAULT_ANNOTATION_COLOR}`,
          fontSize: "clamp(9px, 1.5vw, 15px)",
          whiteSpace: "nowrap",
        }}
      >
        {s.label}
      </span>
    ))}
    {prompts.map((s) => (
      <span
        key={`prompt-${s.id}`}
        className="absolute flex items-center justify-center overflow-hidden p-1 text-center font-medium leading-tight text-white"
        style={{
          left: `${s.x * 100}%`,
          top: `${s.y * 100}%`,
          width: `${s.w * 100}%`,
          height: `${s.h * 100}%`,
          fontSize: "clamp(9px, 1.6vw, 15px)",
          textShadow: "0 1px 2px rgba(0,0,0,0.55)",
        }}
      >
        {s.label}
      </span>
    ))}
    </div>
  );
}

/** An arrow or a star, drawn in the same 0-100 space as the masks. */
function Annotation({ shape }: { shape: OcclusionShape }) {
  const color = shape.color ?? DEFAULT_ANNOTATION_COLOR;
  const kind = shapeKind(shape);
  if (kind === "arrow") {
    const { from, to } = arrowEnds(shape);
    const head = arrowHead(from, to, annotationWeight(shape));
    // Non-scaling strokes keep an arrow the same visual weight whatever size
    // the image is displayed at.
    const width = Math.max(annotationWeight(shape) * 400, 2);
    return (
      <g>
        <line
          x1={from.x * 100}
          y1={from.y * 100}
          x2={to.x * 100}
          y2={to.y * 100}
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <polygon
          points={head.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
          fill={color}
        />
      </g>
    );
  }
  if (kind === "star") {
    return (
      <polygon
        points={starPoints(shape).map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
        fill={color}
        stroke="rgba(255,255,255,0.9)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  // Notes are HTML, so that the stretched viewBox can't distort the glyphs.
  return null;
}
