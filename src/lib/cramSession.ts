// Quizlet/cram session state.
//
// Cram progress is throwaway next to the SRS schedule, but it still has to
// survive a refresh, a closed tab, and a move to another device: losing your
// place halfway through a deck is what makes people start the whole thing
// over. So it lives in two places — localStorage as the synchronous cache
// that makes resuming instant and works offline, and one Firestore doc per
// session so the phone and the laptop agree.
//
// It is kept until the deck is actually finished, then deleted from both.

const PREFIX = "cramSession:";

export interface CramSession {
  /** remaining items, in order, as `${deckId}|${itemKey}` */
  order: string[];
  /** per-item "how well do you know it" counters */
  strengths: [string, number][];
  /** how many times each item has been missed — it decides how much more
   *  work the item owes before it can leave the session */
  misses?: [string, number][];
  /** size the session started at, for the progress bar */
  total: number;
  savedAt: number;
}

function keyFor(scope: string): string {
  return PREFIX + scope;
}

/**
 * A scope can name dozens of decks, which is far too long for a document id,
 * so it's hashed. FNV-1a with the length appended — collisions would only
 * ever mix up two cram sessions, and this makes them vanishingly unlikely.
 */
/**
 * How far through a repeat run you are, 0–100.
 *
 * A card that has left the queue is finished, whatever it took to get there
 * — some go after one answer, because answering instantly and correctly is
 * itself proof you know it. Cards still in the queue count their part-way
 * progress, so the bar moves on every correct answer rather than only when
 * something retires.
 *
 * Counting half-steps for every card instead was wrong in a way that only
 * showed at the end: a deck finished with a dozen cards known on sight
 * stopped at 83%, having credited those cards one step out of two they were
 * never going to take.
 */
export function cramProgress(opts: {
  /** cards in the run */
  total: number;
  /** strengths of the cards still in the queue, one per card */
  remainingStrengths: number[];
  /** correct answers a card needs before it can retire */
  mastery: number;
}): number {
  const { total, remainingStrengths, mastery } = opts;
  if (total <= 0 || mastery <= 0) return 0;
  const retired = Math.max(0, total - remainingStrengths.length);
  let earned = retired * mastery;
  for (const strength of remainingStrengths) {
    earned += Math.min(Math.max(strength, 0), mastery);
  }
  return Math.max(0, Math.min(100, Math.round((earned / (total * mastery)) * 100)));
}

export function cramScopeId(scope: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < scope.length; i++) {
    h ^= scope.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `s${h.toString(36)}${scope.length.toString(36)}`;
}

// ---------- local ----------

function readLocal(scope: string): CramSession | null {
  try {
    const raw = localStorage.getItem(keyFor(scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CramSession;
    if (!Array.isArray(parsed.order) || parsed.order.length === 0) {
      localStorage.removeItem(keyFor(scope));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeLocal(scope: string, session: CramSession) {
  try {
    localStorage.setItem(keyFor(scope), JSON.stringify(session));
  } catch {
    /* storage full or blocked — the remote copy still holds */
  }
}

// ---------- remote, coalesced ----------
// Every answer changes the queue, and a write per answer would be wasteful.
// The local copy is always current; the remote one catches up on a short
// delay and is flushed when the page goes away.

const SYNC_DELAY_MS = 4000;
/**
 * A Firestore document caps at 1 MiB, and the queue is a list of item keys at
 * roughly 50 bytes each. Cram runs are normally one deck, but somebody can
 * point this at a whole collection — past this size the device copy carries it
 * alone rather than pushing a quarter-megabyte every few seconds.
 */
const MAX_REMOTE_ITEMS = 2000;
let pending: { uid: string; scope: string; session: CramSession } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function pushPending() {
  const job = pending;
  pending = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!job) return;
  try {
    const { saveCramProgress } = await import("./firestore");
    await saveCramProgress(job.uid, cramScopeId(job.scope), {
      order: job.session.order,
      strengths: job.session.strengths,
      misses: job.session.misses ?? [],
      total: job.session.total,
      savedAt: job.session.savedAt,
    });
  } catch {
    /* offline — localStorage still has it, and the next save retries */
  }
}

/** Writes any queued progress immediately. Safe to call when there is none. */
export function flushCramSession(): Promise<void> {
  return pushPending();
}

if (typeof window !== "undefined") {
  // pagehide covers the cases visibilitychange misses on iOS Safari.
  window.addEventListener("pagehide", () => void pushPending());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void pushPending();
  });
}

// ---------- public API ----------

export function saveCramSession(
  uid: string | null,
  scope: string,
  session: Omit<CramSession, "savedAt">
) {
  const full: CramSession = { ...session, savedAt: Date.now() };
  writeLocal(scope, full);
  if (!uid || full.order.length > MAX_REMOTE_ITEMS) return;
  // Moving to another deck mid-debounce must not discard the last one's
  // progress, so anything queued for a different scope goes out first.
  if (pending && pending.scope !== scope) void pushPending();
  pending = { uid, scope, session: full };
  if (!timer) timer = setTimeout(() => void pushPending(), SYNC_DELAY_MS);
}

/**
 * The furthest-along session for this scope. The local copy answers instantly;
 * the remote one only wins when it's genuinely newer, which is what makes
 * picking up on another device work. A slow network never blocks the start of
 * studying — we go with what's on the device instead.
 */
export async function loadCramSession(
  uid: string | null,
  scope: string,
  timeoutMs = 2500
): Promise<CramSession | null> {
  const local = readLocal(scope);
  if (!uid) return local;

  let remote: CramSession | null = null;
  try {
    const fetched = await Promise.race([
      import("./firestore").then(({ fetchCramProgress }) =>
        fetchCramProgress(uid, cramScopeId(scope))
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    remote = fetched;
  } catch {
    /* offline or blocked — the local copy is authoritative */
  }

  if (!remote) return local;
  if (!local) return remote;
  return remote.savedAt > local.savedAt ? remote : local;
}

/** Finished (or restarted): drop it everywhere so it costs nothing to keep. */
export function clearCramSession(uid: string | null, scope: string) {
  // Only drop a queued write belonging to the session being cleared.
  if (pending?.scope === scope) {
    pending = null;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }
  try {
    localStorage.removeItem(keyFor(scope));
  } catch {
    /* ignore */
  }
  if (!uid) return;
  import("./firestore")
    .then(({ deleteCramProgress }) => deleteCramProgress(uid, cramScopeId(scope)))
    .catch(() => {});
}

// ---------- "still learning" ----------
// The cards a finished run kept tripping you on. A session is deleted when
// you complete the deck; this list deliberately isn't, so the next sitting can
// start with just the ones that gave you trouble. It holds item keys only.

const TROUBLE_PREFIX = "cramTrouble:";

/** Misses that mark a card as still learning. */
export const STILL_LEARNING_MISSES = 2;

function troubleKey(scope: string): string {
  return TROUBLE_PREFIX + scope;
}

export function saveTroubleList(
  uid: string | null,
  scope: string,
  keys: string[]
) {
  if (keys.length === 0) {
    clearTroubleList(uid, scope);
    return;
  }
  try {
    localStorage.setItem(
      troubleKey(scope),
      JSON.stringify({ keys, savedAt: Date.now() })
    );
  } catch {
    /* best effort */
  }
  if (!uid) return;
  import("./firestore")
    .then(({ saveTroubleList: save }) => save(uid, cramScopeId(scope), keys))
    .catch(() => {});
}

export async function loadTroubleList(
  uid: string | null,
  scope: string,
  timeoutMs = 2500
): Promise<string[]> {
  let local: { keys: string[]; savedAt: number } | null = null;
  try {
    const raw = localStorage.getItem(troubleKey(scope));
    if (raw) local = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  if (!uid) return local?.keys ?? [];

  let remote: { keys: string[]; savedAt: number } | null = null;
  try {
    remote = await Promise.race([
      import("./firestore").then(({ fetchTroubleList }) =>
        fetchTroubleList(uid, cramScopeId(scope))
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    /* offline */
  }
  if (!remote) return local?.keys ?? [];
  if (!local) return remote.keys;
  return remote.savedAt > local.savedAt ? remote.keys : local.keys;
}

export function clearTroubleList(uid: string | null, scope: string) {
  try {
    localStorage.removeItem(troubleKey(scope));
  } catch {
    /* ignore */
  }
  if (!uid) return;
  import("./firestore")
    .then(({ deleteTroubleList }) => deleteTroubleList(uid, cramScopeId(scope)))
    .catch(() => {});
}
