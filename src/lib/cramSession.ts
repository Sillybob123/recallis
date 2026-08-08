// Quizlet/cram session state, kept on the device only.
//
// Cram progress is deliberately short-lived: it must survive a refresh or a
// closed tab mid-session, but once you finish the deck there's nothing worth
// remembering — the long-term schedule lives in Anki mode's SRS state. So this
// goes to localStorage, not Firestore, and is cleared on completion.

const PREFIX = "cramSession:";
/** Sessions older than this are stale; start fresh rather than resume. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface CramSession {
  /** remaining items, in order, as `${deckId}|${itemKey}` */
  order: string[];
  /** per-item "how well do you know it" counters */
  strengths: [string, number][];
  /** size the session started at, for the progress bar */
  total: number;
  savedAt: number;
}

function keyFor(scope: string): string {
  return PREFIX + scope;
}

export function saveCramSession(
  scope: string,
  session: Omit<CramSession, "savedAt">
) {
  try {
    localStorage.setItem(
      keyFor(scope),
      JSON.stringify({ ...session, savedAt: Date.now() })
    );
  } catch {
    /* storage full or blocked — cram progress is best-effort */
  }
}

export function loadCramSession(scope: string): CramSession | null {
  try {
    const raw = localStorage.getItem(keyFor(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CramSession;
    if (
      !Array.isArray(parsed.order) ||
      parsed.order.length === 0 ||
      Date.now() - parsed.savedAt > MAX_AGE_MS
    ) {
      localStorage.removeItem(keyFor(scope));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearCramSession(scope: string) {
  try {
    localStorage.removeItem(keyFor(scope));
  } catch {
    /* ignore */
  }
}
