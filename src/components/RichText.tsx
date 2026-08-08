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
