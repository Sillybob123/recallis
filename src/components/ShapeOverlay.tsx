import type { OcclusionShape } from "../types";
import { shapeColor, shapeKind, shapeOpacity } from "../lib/shapes";

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
    (s) => s.textPrompt && s.label && hiddenIds.has(s.id) && !outlineIds?.has(s.id)
  );
  return (
    <div className="pointer-events-none absolute inset-0">
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      {shapes.map((s) => {
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
