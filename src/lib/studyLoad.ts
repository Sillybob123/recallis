// Loads everything a study session needs across one or many decks (a parent
// deck pools its whole subtree, Anki-style). SRS docs stay in each deck's own
// srs collection; in memory they're keyed `${deckId}|${itemKey}`.

import { getDocs } from "firebase/firestore";
import { decksCol, getCardsOnce, getOcclusionsOnce, getSrsMap } from "./firestore";
import type { SrsState } from "./srs";
import type { Card, OcclusionSheet } from "../types";

export interface StudyData {
  cards: (Card & { deckId: string })[];
  sheets: (OcclusionSheet & { deckId: string })[];
  /** key = `${deckId}|${itemKey}` */
  srs: Map<string, SrsState>;
}

/** One deck's contents, so callers can cache per deck rather than per set. */
export async function loadDeckBundle(
  uid: string,
  deckId: string
): Promise<StudyData> {
  const [cards, sheets, srs] = await Promise.all([
    getCardsOnce(uid, deckId),
    getOcclusionsOnce(uid, deckId),
    getSrsMap(uid, deckId),
  ]);
  return {
    cards: cards.map((c) => ({ ...c, deckId })),
    sheets: sheets.map((sh) => ({ ...sh, deckId })),
    srs: new Map([...srs].map(([key, state]) => [`${deckId}|${key}`, state])),
  };
}

/** Merges per-deck bundles into the single shape the views expect. */
export function mergeStudyData(bundles: Iterable<StudyData>): StudyData {
  const out: StudyData = { cards: [], sheets: [], srs: new Map() };
  for (const b of bundles) {
    out.cards.push(...b.cards);
    out.sheets.push(...b.sheets);
    for (const [k, v] of b.srs) out.srs.set(k, v);
  }
  return out;
}

export async function loadStudyData(
  uid: string,
  deckIds: string[]
): Promise<StudyData> {
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

  const out: StudyData = { cards: [], sheets: [], srs: new Map() };
  for (const { deckId, cards, sheets, srs } of perDeck) {
    for (const c of cards) out.cards.push({ ...c, deckId });
    for (const s of sheets) out.sheets.push({ ...s, deckId });
    for (const [key, state] of srs) out.srs.set(`${deckId}|${key}`, state);
  }
  return out;
}

/** Today's counters (for daily limits) summed over a set of decks' srs maps. */
export async function countTodayAcrossDecks(
  uid: string,
  deckIds: string[],
  dayStart: number
): Promise<{ newToday: number; reviewsToday: number }> {
  let newToday = 0;
  let reviewsToday = 0;
  await Promise.all(
    deckIds.map(async (deckId) => {
      const srs = await getSrsMap(uid, deckId);
      for (const s of srs.values()) {
        if ((s.firstSeen ?? 0) >= dayStart) newToday++;
        if ((s.lastReviewed ?? 0) >= dayStart && s.phase === "review") reviewsToday++;
      }
    })
  );
  return { newToday, reviewsToday };
}

/** Every non-trashed deck id — used for the shared "limits start from top" budget. */
export async function getAllActiveDeckIds(uid: string): Promise<string[]> {
  const snap = await getDocs(decksCol(uid));
  return snap.docs
    .filter((d) => typeof d.data().deletedAt !== "number")
    .map((d) => d.id);
}
