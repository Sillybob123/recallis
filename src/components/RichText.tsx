import DOMPurify from "dompurify";
import { useMemo } from "react";

export function RichText({
  html,
  className = "",
}: {
  html: string;
  className?: string;
}) {
  const clean = useMemo(
    () =>
      DOMPurify.sanitize(html, {
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
        ],
        ALLOWED_ATTR: ["src", "alt", "href", "width", "height", "class", "target", "rel"],
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
