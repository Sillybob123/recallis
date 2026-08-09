import { useEffect, useMemo } from "react";

const COLORS = [
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
];

/**
 * A short burst for finishing a deck. Pure CSS transforms on a handful of
 * absolutely-positioned pieces — no canvas, no dependency, and nothing to
 * clean up but one timer. Sits behind nothing and catches no clicks.
 */
export function Confetti({
  pieces = 90,
  durationMs = 4200,
  onDone,
}: {
  pieces?: number;
  durationMs?: number;
  onDone?: () => void;
}) {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        drift: `${(Math.random() - 0.5) * 40}vw`,
        spin: `${(Math.random() - 0.5) * 1440}deg`,
        delay: Math.random() * 900,
        fall: 2400 + Math.random() * 1600,
        color: COLORS[i % COLORS.length],
        width: 6 + Math.random() * 6,
        height: 9 + Math.random() * 8,
        round: Math.random() < 0.3,
      })),
    [pieces]
  );

  useEffect(() => {
    if (reduced || !onDone) return;
    const t = setTimeout(onDone, durationMs);
    return () => clearTimeout(t);
  }, [durationMs, onDone, reduced]);

  // Someone who asked for less motion gets the result, not the celebration.
  useEffect(() => {
    if (reduced && onDone) onDone();
  }, [reduced, onDone]);

  if (reduced) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
      aria-hidden="true"
    >
      {bits.map((b) => (
        <span
          key={b.id}
          className="confetti-bit"
          style={
            {
              left: `${b.left}%`,
              width: `${b.width}px`,
              height: `${b.height}px`,
              background: b.color,
              borderRadius: b.round ? "50%" : "1px",
              animationDelay: `${b.delay}ms`,
              animationDuration: `${b.fall}ms`,
              "--confetti-drift": b.drift,
              "--confetti-spin": b.spin,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
