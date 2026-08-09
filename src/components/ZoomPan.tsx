import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";

const MIN_SCALE = 1;
const MAX_SCALE = 6;

/**
 * Pinch/scroll zoom with drag panning, for occlusion images that arrive too
 * small to read. The image and its mask overlay are transformed together, so
 * the masks stay exactly where they belong at any zoom.
 *
 * At 1× this is inert and passes every event through — study views layer
 * click-to-flip on top, and panning must not eat those clicks.
 */
export function ZoomPan({
  children,
  className = "",
  resetKey,
}: {
  children: ReactNode;
  className?: string;
  /** changing this returns to 1× — e.g. when the next card comes up */
  resetKey?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  // One piece of state: zoom and pan have to move together or the clamp that
  // keeps the image in frame reads a mix of old and new values.
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const { scale, tx, ty } = view;
  // Live pointers, so two of them can be read as a pinch.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(
    null
  );
  // A pan ends in a click, and study views flip the card on click. Once the
  // pointer has actually travelled, that click is a drag and must not count.
  const movedRef = useRef(false);

  const reset = useCallback(() => setView({ scale: 1, tx: 0, ty: 0 }), []);

  useEffect(() => {
    reset();
  }, [resetKey, reset]);

  /** Keeps the image covering the frame instead of drifting off into space. */
  const clamp = useCallback((s: number, x: number, y: number) => {
    const box = boxRef.current;
    if (!box) return { x, y };
    const { width, height } = box.getBoundingClientRect();
    const minX = width - width * s;
    const minY = height - height * s;
    return {
      x: Math.min(0, Math.max(minX, x)),
      y: Math.min(0, Math.max(minY, y)),
    };
  }, []);

  /** Zooms about a point in container coordinates, so it stays put. */
  const zoomAt = useCallback(
    (nextScale: number, px: number, py: number) => {
      setView((prev) => {
        const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
        if (s === prev.scale) return prev;
        const ratio = s / prev.scale;
        const { x, y } = clamp(
          s,
          px - (px - prev.tx) * ratio,
          py - (py - prev.ty) * ratio
        );
        return { scale: s, tx: x, ty: y };
      });
    },
    [clamp]
  );

  function localPoint(e: { clientX: number; clientY: number }) {
    const rect = boxRef.current?.getBoundingClientRect();
    return {
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    };
  }

  function onWheel(e: React.WheelEvent) {
    // Trackpad pinch arrives as a ctrl-wheel; a plain wheel should still
    // scroll the page unless we're already zoomed in.
    if (!e.ctrlKey && scale === 1) return;
    e.preventDefault();
    const p = localPoint(e);
    zoomAt(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), p.x, p.y);
  }

  function onPointerDown(e: React.PointerEvent) {
    movedRef.current = false;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchRef.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale,
      };
      dragRef.current = null;
      return;
    }
    if (scale > 1) {
      dragRef.current = { x: e.clientX, y: e.clientY, tx, ty };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pinch = pinchRef.current;
    if (pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      movedRef.current = true;
      if (pinch.dist > 0) {
        const mid = localPoint({
          clientX: (a.x + b.x) / 2,
          clientY: (a.y + b.y) / 2,
        });
        zoomAt((pinch.scale * dist) / pinch.dist, mid.x, mid.y);
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) {
      movedRef.current = true;
    }
    const next = clamp(
      scale,
      drag.tx + (e.clientX - drag.x),
      drag.ty + (e.clientY - drag.y)
    );
    setView((prev) => ({ ...prev, tx: next.x, ty: next.y }));
  }

  function endPointer(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0) dragRef.current = null;
  }

  const zoomed = scale > 1;

  return (
    <div
      ref={boxRef}
      className={`relative overflow-hidden ${zoomed ? "touch-none" : ""} ${className}`}
      onWheel={onWheel}
      onClickCapture={(e) => {
        if (!movedRef.current) return;
        movedRef.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onPointerLeave={endPointer}
      style={{ cursor: zoomed ? (dragRef.current ? "grabbing" : "grab") : undefined }}
    >
      <div
        className="relative origin-top-left"
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transition: dragRef.current || pinchRef.current ? "none" : "transform 90ms linear",
        }}
      >
        {children}
      </div>

      <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-white/85 p-1 shadow-sm backdrop-blur">
        <ZoomButton
          label="Zoom out"
          disabled={scale <= MIN_SCALE}
          onClick={() => {
            const box = boxRef.current?.getBoundingClientRect();
            zoomAt(scale / 1.5, (box?.width ?? 0) / 2, (box?.height ?? 0) / 2);
          }}
        >
          <Minus size={14} />
        </ZoomButton>
        <span className="w-9 text-center text-[11px] font-semibold tabular-nums text-slate-500">
          {Math.round(scale * 100)}%
        </span>
        <ZoomButton
          label="Zoom in"
          disabled={scale >= MAX_SCALE}
          onClick={() => {
            const box = boxRef.current?.getBoundingClientRect();
            zoomAt(scale * 1.5, (box?.width ?? 0) / 2, (box?.height ?? 0) / 2);
          }}
        >
          <Plus size={14} />
        </ZoomButton>
        <ZoomButton label="Reset zoom" disabled={!zoomed} onClick={reset}>
          <Maximize2 size={13} />
        </ZoomButton>
      </div>
    </div>
  );
}

function ZoomButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      // The image sits inside click-to-flip areas in study views.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded p-1 text-slate-500 transition enabled:hover:bg-slate-100 enabled:hover:text-slate-800 disabled:opacity-30"
    >
      {children}
    </button>
  );
}
