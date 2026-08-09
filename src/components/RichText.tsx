import DOMPurify from "dompurify";
import { useMemo } from "react";
import { makeColorsReadable } from "../lib/readableColor";

export function RichText({
  html,
  className = "",
}: {
  html: string;
  className?: string;
}) {
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
  return (
    <div
      className={`prose-card ${className}`}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
