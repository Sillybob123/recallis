// Anki-compatible tags.
//
// Anki stores a note's tags as one space-separated string padded with spaces
// (" anatomy thorax "), which means a tag can never contain a space —
// hierarchy uses "::" instead ("anatomy::thorax"). Normalizing on the way in
// keeps imports, the editor, and export all speaking the same language.

export function parseTagString(raw: string): string[] {
  return normalizeTags(raw.split(/\s+/));
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Map<string, string>();
  for (const tag of tags) {
    const clean = tag.trim().replace(/\s+/g, "::");
    if (!clean) continue;
    // Case-insensitive de-dupe, keeping the first spelling seen.
    const key = clean.toLowerCase();
    if (!seen.has(key)) seen.set(key, clean);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

/** The form Anki expects in an export column. */
export function formatTagString(tags: string[] | undefined): string {
  return normalizeTags(tags ?? []).join(" ");
}

export function addTags(existing: string[] | undefined, add: string[]): string[] {
  return normalizeTags([...(existing ?? []), ...add]);
}

export function removeTags(
  existing: string[] | undefined,
  remove: string[]
): string[] {
  const drop = new Set(normalizeTags(remove).map((t) => t.toLowerCase()));
  return normalizeTags(existing ?? []).filter((t) => !drop.has(t.toLowerCase()));
}

/** "anatomy::thorax" also matches a filter on "anatomy". */
export function tagMatches(tag: string, filter: string): boolean {
  const a = tag.toLowerCase();
  const b = filter.toLowerCase();
  return a === b || a.startsWith(b + "::");
}
