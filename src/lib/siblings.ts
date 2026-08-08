// Sibling handling.
//
// One note can produce several cards: {{c1::…}} and {{c2::…}} from the same
// sentence, or every mask on one occlusion image. Those are siblings. Showing
// c2 right after c1 tests almost nothing — the sentence is still sitting in
// working memory, so you pattern-match instead of recalling.
//
// Anki's answer is to bury siblings until tomorrow. That's too blunt for dense
// medical notes: a nine-cloze note about the branches of a nerve would take
// nine days to get through. The default here disperses instead — siblings stay
// in today's session but are pushed far enough back that the answer has faded.

import type { StudyItem } from "./studyItems";

export type SiblingMode = "disperse" | "bury" | "off";

/** Even with protection off, never show siblings back to back. */
export const MIN_SIBLING_GAP = 5;

/** Cards sharing this id came from the same note. */
export function siblingGroup(item: StudyItem): string {
  return item.kind === "text"
    ? `${item.deckId}|${item.cardId}`
    : `${item.deckId}|${item.sheet.id}`;
}

export function isSibling(a: StudyItem, b: StudyItem): boolean {
  return a.key !== b.key && siblingGroup(a) === siblingGroup(b);
}

/**
 * Moves any sibling of `answered` that sits within `gap` positions further
 * back, preserving their relative order. Returns the same array when nothing
 * needed moving, so callers can skip a re-render.
 */
export function disperseSiblings(
  queue: StudyItem[],
  answered: StudyItem,
  gap: number
): StudyItem[] {
  const effectiveGap = Math.max(gap, MIN_SIBLING_GAP);
  if (queue.length <= 1) return queue;

  const tooClose: StudyItem[] = [];
  const rest: StudyItem[] = [];
  queue.forEach((item, index) => {
    if (index < effectiveGap && isSibling(item, answered)) tooClose.push(item);
    else rest.push(item);
  });
  if (tooClose.length === 0) return queue;

  const at = Math.min(effectiveGap, rest.length);
  return [...rest.slice(0, at), ...tooClose, ...rest.slice(at)];
}

/** Removes every sibling of `answered` from the session. */
export function removeSiblings(
  queue: StudyItem[],
  answered: StudyItem
): { queue: StudyItem[]; removed: StudyItem[] } {
  const removed = queue.filter((item) => isSibling(item, answered));
  if (removed.length === 0) return { queue, removed };
  const keys = new Set(removed.map((item) => item.key));
  return { queue: queue.filter((item) => !keys.has(item.key)), removed };
}

/**
 * Orders a freshly built queue so no two cards from the same note land within
 * `gap` of each other. Without this a session can open with every cloze of one
 * sentence back to back, since cards from a note are created together.
 *
 * Greedy: repeatedly take the first card whose note hasn't been seen recently,
 * falling back to the next card when only crowded ones remain.
 */
export function spreadSiblings(queue: StudyItem[], gap: number): StudyItem[] {
  if (queue.length <= 2) return queue;

  // A note with many cards can't always hold the full gap: nine clozes in a
  // 60-card session only fit about six apart. Give each note the widest even
  // spacing its size allows, so the gap stays consistent instead of being
  // generous early and collapsing to back-to-back at the end.
  const groupSize = new Map<string, number>();
  for (const item of queue) {
    const g = siblingGroup(item);
    groupSize.set(g, (groupSize.get(g) ?? 0) + 1);
  }
  const gapFor = (group: string) => {
    const size = groupSize.get(group) ?? 1;
    if (size < 2) return 0;
    // Feasibility wins over the floor: demanding 5 apart when only 2 fit
    // makes the algorithm give up and bunch the tail together.
    const feasible = Math.floor(queue.length / size);
    return Math.max(1, Math.min(gap, feasible));
  };

  const remaining = [...queue];
  const out: StudyItem[] = [];
  const lastSeen = new Map<string, number>();

  while (remaining.length > 0) {
    let pick = remaining.findIndex((item) => {
      const group = siblingGroup(item);
      const last = lastSeen.get(group);
      return last === undefined || out.length - last >= gapFor(group);
    });
    if (pick === -1) {
      // Everything left is crowded; take whichever note has waited longest.
      let oldest = Infinity;
      pick = 0;
      remaining.forEach((item, i) => {
        const last = lastSeen.get(siblingGroup(item)) ?? -Infinity;
        if (last < oldest) {
          oldest = last;
          pick = i;
        }
      });
    }
    const [item] = remaining.splice(pick, 1);
    lastSeen.set(siblingGroup(item), out.length);
    out.push(item);
  }
  return out;
}
