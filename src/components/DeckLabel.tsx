import { deckLeafName, deckParentPath, normalizeDeckPath, splitDeckPath } from "../lib/deckPath";

/**
 * A deck path in a narrow row.
 *
 * Truncating "SAMKI::TANKI::M1::1 Foundations::B1 Anatomy::Exam 1::Week 1"
 * from the right gives "SAMKI::TANKI::M1::1 Found…" — inside its box, and
 * useless: every deck in the course begins the same way, and the part that
 * identifies this one is exactly the part that got cut.
 *
 * So the leaf comes first and the ancestors follow in small grey type. When
 * there isn't room, what disappears is the shared prefix rather than the
 * name — which is the right way round on a phone, where there is rarely
 * room.
 */
export function DeckLabel({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  const full = normalizeDeckPath(name);
  const parent = deckParentPath(full);
  return (
    <span
      className={`min-w-0 truncate text-sm font-medium text-slate-800 ${className}`}
      title={full}
    >
      {deckLeafName(full)}
      {parent && (
        <span className="ml-1.5 text-xs font-normal text-slate-400">
          {splitDeckPath(parent).join(" › ")}
        </span>
      )}
    </span>
  );
}
