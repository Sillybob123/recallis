import { useRef } from "react";
import type { OcclusionShape } from "../types";
import { NoteBox, useBoxSize } from "./NoteBox";
import { canvasMeasure, fitText, FIT_FONT_STACK } from "../lib/fitText";
import {
  annotationVisible,
  annotationWeight,
  arrowEnds,
  arrowHead,
  DEFAULT_ANNOTATION_COLOR,
  isAnnotation,
  isCover,
  shapeColor,
  shapeKind,
  shapeOpacity,
  starPoints,
} from "../lib/shapes";

const TARGET_COLOR = "#f59e0b";

const promptMeasure = canvasMeasure(600);

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
  revealed = false,
}: {
  shapes: OcclusionShape[];
  hiddenIds: Set<string>;
  targetIds: Set<string>;
  outlineIds?: Set<string>;
  /** whether the answer is showing — reveal-only notes wait for this */
  revealed?: boolean;
}) {
  const ctx = { revealed, unitShapeIds: targetIds };
  // Notes are sized in pixels, so the overlay has to know how big it is.
  const rootRef = useRef<HTMLDivElement>(null);
  const box = useBoxSize(rootRef);
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
  const notes = shapes.filter(
    (s) => shapeKind(s) === "note" && s.label && annotationVisible(s, ctx)
  );
  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0">
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {shapes.map((s) => {
        if (isAnnotation(s)) {
          return annotationVisible(s, ctx) ? (
            <Annotation key={s.id} shape={s} />
          ) : null;
        }
        // A cover is painted whatever the card is asking, including on the
        // answer — revealing it would be the spoiler it exists to prevent.
        // occlusionVisibility already worked out what is covered on this
        // card, covers included — asking again here would be a second rule
        // to keep in step with the first.
        const hidden = hiddenIds.has(s.id);
        const outlined = !isCover(s) && (outlineIds?.has(s.id) ?? false);
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
      <NoteBox
        key={`note-${s.id}`}
        shape={s}
        containerWidth={box.width}
        containerHeight={box.height}
      />
    ))}
    {prompts.map((s) => (
      <PromptText
        key={`prompt-${s.id}`}
        shape={s}
        containerWidth={box.width}
        containerHeight={box.height}
      />
    ))}
    </div>
  );
}

/**
 * The question written across a covered mask.
 *
 * Fitted the same way a note is: it used to be a fixed responsive size with
 * the overflow hidden, so a question longer than a few words was simply cut
 * off mid-sentence — on the one card where you needed to read it.
 */
function PromptText({
  shape,
  containerWidth,
  containerHeight,
}: {
  shape: OcclusionShape;
  containerWidth: number;
  containerHeight: number;
}) {
  if (containerWidth <= 0 || containerHeight <= 0) return null;
  const fit = fitText(
    shape.label ?? "",
    shape.w * containerWidth,
    shape.h * containerHeight,
    promptMeasure,
    // Smaller ceiling than a note: this sits on top of a mask, and reads as
    // a prompt rather than a heading.
    { max: 26, padding: 5 }
  );
  return (
    <span
      className="absolute flex flex-col items-center justify-center overflow-hidden text-center text-white"
      style={{
        left: `${shape.x * 100}%`,
        top: `${shape.y * 100}%`,
        width: `${shape.w * 100}%`,
        height: `${shape.h * 100}%`,
        fontFamily: FIT_FONT_STACK,
        fontWeight: 600,
        fontSize: `${fit.fontSize}px`,
        lineHeight: fit.lineHeight,
        textShadow: "0 1px 2px rgba(0,0,0,0.55)",
        padding: 5,
      }}
    >
      {fit.lines.map((line, i) => (
        <span key={i} style={{ whiteSpace: "pre" }}>
          {line}
        </span>
      ))}
    </span>
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
