import { getCardsOnce, getOcclusionsOnce, getSrsMap } from "./firestore";
import { buildOcclusionItems, buildTextItems } from "./studyItems";
import { loadAnkiSettings, startOfStudyDay } from "./settings";
import { isExcluded, isNew } from "./srs";

export interface DeckPractice {
  /** study items in the deck */
  total: number;
  /** items answered wrong more often than right — worth another pass */
  shaky: number;
  /** 0-1 accuracy over everything answered so far, or null if untouched */
  accuracy: number | null;
}

export interface DeckCounts {
  newCount: number;
  learnCount: number;
  dueCount: number;
  /**
   * Uncapped tallies. A parent row must sum these and apply the daily
   * allowance once — summing already-capped children would let a parent
   * report the full limit no matter how much you'd already studied.
   */
  newRaw: number;
  dueRaw: number;
  /** today's remaining budget; shared by every deck (one preset) */
  newAllowance: number;
  reviewAllowance: number;
  /** review cards that come due during tomorrow */
  dueTomorrow: number;
  practice: DeckPractice;
}

/**
 * Anki's deck-list counters.
 *
 * New   — never answered, capped by what's left of today's new-card limit.
 * Learn — in a learning or relearning step and scheduled within today. Cards
 *         waiting out a 10-minute step count here too; Learn isn't "cards you
 *         failed", it's "cards that haven't graduated yet".
 * Due   — graduated review cards whose date has arrived, capped by what's
 *         left of today's review limit.
 *
 * The daily limits belong to one shared preset, so the day's usage is counted
 * across every deck rather than per deck.
 */
export async function computeAllDeckCounts(
  uid: string,
  deckIds: string[]
): Promise<Map<string, DeckCounts>> {
  const settings = loadAnkiSettings();
  const now = Date.now();
  const dayStart = startOfStudyDay(now);
  const nextDayStart = dayStart + 86400000;
  const tomorrowEnd = nextDayStart + 86400000;

  const perDeck = await Promise.all(
    deckIds.map(async (deckId) => {
      const [cards, sheets, srs] = await Promise.all([
        getCardsOnce(uid, deckId),
        getOcclusionsOnce(uid, deckId),
        getSrsMap(uid, deckId),
      ]);
      return { deckId, cards, sheets, srs };
    })
  );

  // How much of today's budget is already spent, across all decks.
  let newToday = 0;
  let reviewsToday = 0;
  for (const { srs } of perDeck) {
    for (const s of srs.values()) {
      if ((s.firstSeen ?? 0) >= dayStart) newToday++;
      if ((s.lastReviewed ?? 0) >= dayStart && s.phase === "review") reviewsToday++;
    }
  }
  const newAllowance = Math.max(0, settings.newPerDay - newToday);
  const reviewAllowance = Math.max(0, settings.maxReviewsPerDay - reviewsToday);

  const result = new Map<string, DeckCounts>();
  for (const { deckId, cards, sheets, srs } of perDeck) {
    const items = [
      ...buildTextItems(cards.map((c) => ({ ...c, deckId }))),
      ...buildOcclusionItems(sheets.map((sh) => ({ ...sh, deckId }))),
    ];

    let newRaw = 0;
    let learnCount = 0;
    let dueRaw = 0;
    let dueTomorrow = 0;

    for (const item of items) {
      const s = srs.get(item.key);
      if (isExcluded(s, now)) continue;

      if (isNew(s)) {
        newRaw++;
        continue;
      }
      if (s!.phase === "review") {
        if (s!.due <= now) {
          dueRaw++;
        } else if (s!.due >= nextDayStart && s!.due < tomorrowEnd) {
          dueTomorrow++;
        }
      } else if (s!.due < nextDayStart) {
        // Learning/relearning scheduled for any time today, including a step
        // that's still counting down.
        learnCount++;
      }
    }

    // Practice signal comes from plain right/wrong tallies, so it reflects
    // Quizlet cramming too — not just the Anki schedule.
    let right = 0;
    let wrong = 0;
    let shaky = 0;
    for (const card of cards) {
      const st = card.stats ?? { correct: 0, incorrect: 0 };
      right += st.correct;
      wrong += st.incorrect;
      if (st.incorrect > st.correct) shaky++;
    }
    const answered = right + wrong;

    result.set(deckId, {
      newRaw,
      dueRaw,
      newAllowance,
      reviewAllowance,
      newCount: Math.min(newRaw, newAllowance),
      learnCount,
      dueCount: Math.min(dueRaw, reviewAllowance),
      dueTomorrow,
      practice: {
        total: items.length,
        shaky,
        accuracy: answered > 0 ? right / answered : null,
      },
    });
  }

  return result;
}

export async function computeDeckCounts(
  uid: string,
  deckId: string
): Promise<DeckCounts> {
  const all = await computeAllDeckCounts(uid, [deckId]);
  return all.get(deckId)!;
}
