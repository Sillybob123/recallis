// Anki-style deck hierarchy. A deck's full path lives in its name, with "::"
// between levels ("Anatomy::Lab 3::Breast and Thorax"), so creating a nested
// deck is just naming it — exactly how Anki works, and how .apkg imports and
// exports already express their trees.

import type { Deck } from "../types";

export const SEP = "::";

/** Splits a stored deck name into levels, tolerating the older " · " form. */
export function splitDeckPath(name: string): string[] {
  return name
    .split(/\s*::\s*|\s+·\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function joinDeckPath(segments: string[]): string {
  return segments.filter(Boolean).join(SEP);
}

/** Canonical "A::B::C" form, whatever separator was stored. */
export function normalizeDeckPath(name: string): string {
  return joinDeckPath(splitDeckPath(name));
}

/** Just the last level — what a tree row shows. */
export function deckLeafName(name: string): string {
  const parts = splitDeckPath(name);
  return parts[parts.length - 1] ?? name;
}

export function deckParentPath(name: string): string {
  return joinDeckPath(splitDeckPath(name).slice(0, -1));
}

export interface DeckNode {
  /** full canonical path */
  path: string;
  name: string;
  depth: number;
  /** the deck itself, when one exists at this path */
  deck?: Deck;
  children: DeckNode[];
}

/**
 * Builds the deck tree. Intermediate levels that have no deck of their own
 * still appear as nodes (Anki shows those too), so "Anatomy::Lab 3::X" renders
 * under an "Anatomy" row even if no plain "Anatomy" deck was ever created.
 */
export function buildDeckTree(decks: Deck[]): DeckNode[] {
  const roots: DeckNode[] = [];
  const byPath = new Map<string, DeckNode>();

  const sorted = [...decks].sort((a, b) =>
    normalizeDeckPath(a.name).localeCompare(normalizeDeckPath(b.name), undefined, {
      numeric: true,
      sensitivity: "base",
    })
  );

  for (const deck of sorted) {
    const segments = splitDeckPath(deck.name);
    if (segments.length === 0) continue;
    let parentList = roots;
    let accumulated: string[] = [];

    segments.forEach((segment, i) => {
      accumulated = [...accumulated, segment];
      const path = joinDeckPath(accumulated);
      let node = byPath.get(path);
      if (!node) {
        node = { path, name: segment, depth: i, children: [] };
        byPath.set(path, node);
        parentList.push(node);
      }
      if (i === segments.length - 1) node.deck = deck;
      parentList = node.children;
    });
  }

  return roots;
}

/** Every deck at or beneath a node — what a parent-level "Study" pools. */
export function collectDecks(node: DeckNode): Deck[] {
  const out: Deck[] = [];
  const stack: DeckNode[] = [node];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.deck) out.push(n.deck);
    stack.push(...n.children);
  }
  return out;
}

export function flattenTree(nodes: DeckNode[]): DeckNode[] {
  const out: DeckNode[] = [];
  const walk = (list: DeckNode[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Finds an existing deck whose path matches, ignoring separator style/case. */
/**
 * The chosen decks plus everything beneath them.
 *
 * Selecting a parent has to mean its subtree — clicking "Anatomy" when every
 * card lives in "Anatomy::Thorax" should not come back empty. Matching on
 * the path prefix with the separator attached is what stops "Anatomy" from
 * also dragging in "Anatomy 2".
 */
export function deckSubtreeIds(decks: Deck[], rootIds: string[]): string[] {
  const chosen = new Set(rootIds);
  const prefixes = decks
    .filter((d) => chosen.has(d.id))
    .map((d) => `${normalizeDeckPath(d.name)}::`);
  return decks
    .filter(
      (d) =>
        chosen.has(d.id) ||
        prefixes.some((p) => normalizeDeckPath(d.name).startsWith(p))
    )
    .map((d) => d.id);
}

export function findDeckByPath(decks: Deck[], path: string): Deck | undefined {
  const target = normalizeDeckPath(path).toLowerCase();
  return decks.find((d) => normalizeDeckPath(d.name).toLowerCase() === target);
}
