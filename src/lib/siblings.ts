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

  // Each one gets its own slot. Dropping them all at a single index only
  // moves the pile-up: an image with four masks came back as those four in a
  // row, which reads as being asked the same card over and over.
  const out = [...rest];
  for (const item of tooClose) {
    out.splice(slotFor(out, item, effectiveGap), 0, item);
  }

  // The card just answered was put back at a fixed distance, chosen without
  // knowing where its own siblings sit — so it can land right beside one.
  // Nudge it later if so; never earlier, or the spacing it was given is lost.
  const self = out.findIndex((item) => item.key === answered.key);
  if (self !== -1) {
    const [moved] = out.splice(self, 1);
    const target = feasibleGap(out, moved, effectiveGap);
    if (roomAt(out, moved, self) < target) {
      // Search outward from where it was put, so it keeps as much of its
      // intended distance as the queue can actually give it.
      out.splice(nearestSlot(out, moved, self, target, effectiveGap), 0, moved);
    } else {
      out.splice(self, 0, moved);
    }
  }
  return out;
}

/**
 * Where to drop `item` so that it is far from the front *and* far from every
 * other card off the same note — the card just answered included, since it is
 * sitting in the queue too.
 *
 * Both distances matter at once. Treating "at least `gap` from the front" as a
 * hard starting point breaks down as soon as the queue is shorter than the
 * gap: the search clamps to the end and lands the card right beside its own
 * siblings. Scoring the two together degrades gracefully instead, so a session
 * that is mostly one occlusion sheet still spreads its masks as widely as the
 * remaining cards allow.
 */
function slotFor(queue: StudyItem[], item: StudyItem, gap: number): number {
  const kin = kinOf(queue, item);
  if (kin.length === 0) return Math.min(gap, queue.length);
  const target = feasibleGap(queue, item, gap);

  let best = 0;
  let bestRoom = -1;
  for (let i = 0; i <= queue.length; i++) {
    const room = Math.min(i, roomAt(queue, item, i));
    if (room >= target) return i;
    // Ties go to the later slot: further from the card just answered.
    if (room >= bestRoom) {
      bestRoom = room;
      best = i;
    }
  }
  return best;
}

/** Index of every card in `queue` off the same note as `item`. */
function kinOf(queue: StudyItem[], item: StudyItem): number[] {
  const group = siblingGroup(item);
  const out: number[] = [];
  queue.forEach((q, i) => {
    if (siblingGroup(q) === group) out.push(i);
  });
  return out;
}

/** Distance from insertion point `i` to the nearest card off the same note. */
function roomAt(queue: StudyItem[], item: StudyItem, i: number): number {
  let room = Infinity;
  // Cards at or after the insertion point shift one to the right.
  for (const j of kinOf(queue, item)) {
    room = Math.min(room, Math.abs((j < i ? j : j + 1) - i));
  }
  return room;
}

/**
 * The gap actually achievable. Five masks cannot sit ten apart in twenty
 * cards, and demanding it makes the search give up and leave them touching —
 * so the requested gap is capped at what the queue can hold, as
 * spreadSiblings already does when building one.
 */
function feasibleGap(queue: StudyItem[], item: StudyItem, gap: number): number {
  const size = kinOf(queue, item).length + 1;
  if (size < 2) return gap;
  return Math.max(2, Math.min(gap, Math.floor((queue.length + 1) / size)));
}

/** The slot closest to `preferred` with room, never nearer the front than `floor`. */
function nearestSlot(
  queue: StudyItem[],
  item: StudyItem,
  preferred: number,
  target: number,
  floor: number
): number {
  const limit = Math.min(floor, preferred);
  let best = preferred;
  let bestRoom = -1;
  for (let d = 0; d <= queue.length; d++) {
    for (const i of d === 0 ? [preferred] : [preferred + d, preferred - d]) {
      if (i < limit || i > queue.length) continue;
      const room = roomAt(queue, item, i);
      if (room >= target) return i;
      if (room > bestRoom) {
        bestRoom = room;
        best = i;
      }
    }
  }
  return best;
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
