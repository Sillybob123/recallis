// Recently studied decks, kept on the device — used by the Quizlet home page
// to offer "pick up where you left off".

const KEY = "recentDecks";
const MAX = 8;

export interface RecentDeck {
  deckId: string;
  at: number;
}

export function recordRecentDecks(deckIds: string[]) {
  try {
    const now = Date.now();
    const existing = loadRecentDecks().filter((r) => !deckIds.includes(r.deckId));
    const next = [...deckIds.map((deckId) => ({ deckId, at: now })), ...existing];
    localStorage.setItem(KEY, JSON.stringify(next.slice(0, MAX)));
  } catch {
    /* best-effort */
  }
}

export function loadRecentDecks(): RecentDeck[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentDeck[]) : [];
  } catch {
    return [];
  }
}
