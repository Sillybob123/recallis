import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { makeColorsReadable } from "../lib/readableColor";
import { annotateAnatomy } from "../lib/anatomyAnnotate";

export function RichText({
  html,
  className = "",
  anatomy = false,
}: {
  html: string;
  className?: string;
  /** gloss Latin/Greek word parts (Anatomy mode) */
  anatomy?: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(
    null
  );
  // Colours are fixed before sanitizing, so DOMPurify still has the last word
  // on everything that reaches the DOM. Doing it at render rather than at
  // import means decks imported earlier are readable too, and the original
  // markup is never overwritten.
  const clean = useMemo(
    () =>
      DOMPurify.sanitize(makeColorsReadable(html), {
        ALLOWED_TAGS: [
          "b",
          "strong",
          "i",
          "em",
          "u",
          "div",
          "span",
          "br",
          "ul",
          "ol",
          "li",
          "img",
          "a",
          "sub",
          "sup",
          "p",
          "code",
          "small",
          "h1",
          "h2",
          "h3",
          "h4",
          "s",
          "strike",
          "del",
          "input",
          "hr",
          "mark",
          "font",
          "table",
          "thead",
          "tbody",
          "tr",
          "td",
          "th",
          "blockquote",
        ],
        ALLOWED_ATTR: ["src", "alt", "href", "width", "height", "class", "target", "rel", "style", "color", "face", "size", "type", "checked", "align"],
      }),
    [html]
  );
  // Runs after React has written the HTML, and only over text nodes, so the
  // markup and the cloze spans are left as they were.
  useEffect(() => {
    if (!anatomy || !bodyRef.current) return;
    annotateAnatomy(bodyRef.current);
  }, [clean, anatomy]);

  useEffect(() => setTip(null), [clean]);

  function showFor(target: EventTarget | null) {
    const el = (target as HTMLElement | null)?.closest?.(".anat-term");
    if (!(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    setTip({
      x: rect.left + rect.width / 2,
      y: rect.top,
      text: el.getAttribute("data-gloss") ?? "",
    });
    return true;
  }

  return (
    <>
      <div
        ref={bodyRef}
        // Remounted when the mode changes so the annotation is applied or
        // dropped rather than layered on top of itself.
        key={anatomy ? "anat" : "plain"}
        className={`prose-card ${className}`}
        onMouseOver={anatomy ? (e) => showFor(e.target) : undefined}
        onMouseOut={anatomy ? () => setTip(null) : undefined}
        onClick={
          anatomy
            ? (e) => {
                // Tapping a marked word explains it instead of flipping the
                // card underneath — that's what the underline is inviting.
                if (showFor(e.target)) e.stopPropagation();
              }
            : undefined
        }
        dangerouslySetInnerHTML={{ __html: clean }}
      />
      {tip &&
        createPortal(
          <span
            className="pointer-events-none fixed z-[70] max-w-xs -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-lg"
            style={{ left: tip.x, top: tip.y - 8 }}
          >
            {tip.text}
          </span>,
          document.body
        )}
    </>
  );
}
