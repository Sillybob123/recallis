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
  /** today's remaining budget; identical for every deck (one shared preset) */
  newAllowance: number;
  reviewAllowance: number;
  /** review cards that come due during tomorrow */
  dueTomorrow: number;
  practice: DeckPractice;
}

/**
 * Anki-main-screen style counts for one deck:
 * New — never-graded items, capped by today's remaining new-card allowance.
 * Learn — learning/relearning items due now.
 * Due — review items due now, capped by today's remaining review allowance.
 */
export async function computeDeckCounts(
  uid: string,
  deckId: string
): Promise<DeckCounts> {
  const [cards, sheets, srs] = await Promise.all([
    getCardsOnce(uid, deckId),
    getOcclusionsOnce(uid, deckId),
    getSrsMap(uid, deckId),
  ]);
  const settings = loadAnkiSettings();
  const now = Date.now();
  const dayStart = startOfStudyDay(now);

  const items = [
    ...buildTextItems(cards.map((c) => ({ ...c, deckId }))),
    ...buildOcclusionItems(sheets.map((sh) => ({ ...sh, deckId }))),
  ];

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
  const practice = {
    total: items.length,
    shaky,
    accuracy: answered > 0 ? right / answered : null,
  };

  let newRaw = 0;
  let learnCount = 0;
  let dueRaw = 0;
  let dueTomorrow = 0;
  const tomorrowStart = dayStart + 86400000;
  const tomorrowEnd = tomorrowStart + 86400000;
  let newToday = 0;
  let reviewsToday = 0;

  for (const item of items) {
    const s = srs.get(item.key);
    if (s) {
      if ((s.firstSeen ?? 0) >= dayStart) newToday++;
      if ((s.lastReviewed ?? 0) >= dayStart && s.phase === "review") reviewsToday++;
    }
    if (isExcluded(s, now)) continue;
    if (s && !isNew(s) && s.due > now && s.due < tomorrowEnd) dueTomorrow++;
    if (isNew(s)) {
      newRaw++;
    } else if (s!.due <= now) {
      if (s!.phase === "review") dueRaw++;
      else learnCount++;
    }
  }

  const newAllowance = Math.max(0, settings.newPerDay - newToday);
  const reviewAllowance = Math.max(0, settings.maxReviewsPerDay - reviewsToday);
  return {
    practice,
    dueTomorrow,
    newRaw,
    dueRaw,
    newAllowance,
    reviewAllowance,
    newCount: Math.min(newRaw, newAllowance),
    learnCount,
    dueCount: Math.min(dueRaw, reviewAllowance),
  };
}
