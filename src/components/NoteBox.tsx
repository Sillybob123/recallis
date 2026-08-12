import { useEffect, useState } from "react";
import type { OcclusionShape } from "../types";
import { shapeColor } from "../lib/shapes";
import { canvasMeasure, fitText, FIT_FONT_STACK } from "../lib/fitText";

/**
 * Reports the pixel size of an element, so a note drawn in fractions of the
 * image can work out how big its box actually is on screen. Text can only be
 * fitted in pixels; everything else about a shape is stored proportionally.
 */
export function useBoxSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setSize((prev) =>
        prev.width === box.width && prev.height === box.height
          ? prev
          : { width: box.width, height: box.height }
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

const measure = canvasMeasure(700);

/**
 * A note or explanation drawn on the image.
 *
 * The text wraps and shrinks until it fits the rectangle it was given: a
 * label that spills over its box covers the anatomy underneath, which
 * defeats the point of putting it there. The same fitting runs when the
 * card is baked for export, so the two pictures agree.
 */
export function NoteBox({
  shape,
  containerWidth,
  containerHeight,
  selected = false,
  onPointerDown,
  children,
}: {
  shape: OcclusionShape;
  containerWidth: number;
  containerHeight: number;
  selected?: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  /** editor extras, e.g. the resize handle */
  children?: React.ReactNode;
}) {
  const color = shapeColor(shape);
  // Before the first measurement there is nothing to fit text to; drawing
  // now would flash a box of minimum-size type for a frame.
  if (containerWidth <= 0 || containerHeight <= 0) return null;
  const boxW = shape.w * containerWidth;
  const boxH = shape.h * containerHeight;
  const fit = fitText(shape.label ?? "", boxW, boxH, measure);

  return (
    <div
      onPointerDown={onPointerDown}
      className="absolute flex flex-col justify-center overflow-hidden rounded-md"
      style={{
        left: `${shape.x * 100}%`,
        top: `${shape.y * 100}%`,
        width: `${shape.w * 100}%`,
        height: `${shape.h * 100}%`,
        background: "rgba(255,255,255,0.93)",
        border: `${selected ? 2 : 1}px ${shape.onReveal ? "dashed" : "solid"} ${color}`,
        padding: 4,
        pointerEvents: onPointerDown ? "auto" : "none",
        cursor: onPointerDown ? "move" : undefined,
      }}
    >
      {fit.lines.map((line, i) => (
        <span
          key={i}
          style={{
            color,
            fontFamily: FIT_FONT_STACK,
            fontWeight: 700,
            fontSize: `${fit.fontSize}px`,
            lineHeight: fit.lineHeight,
            // Wrapping is decided above, to the pixel; letting the browser
            // wrap again would undo the fit.
            whiteSpace: "pre",
            textAlign: "center",
          }}
        >
          {line}
        </span>
      ))}
      {children}
    </div>
  );
}
