// Durable writer for Anki scheduling state.
//
// Every grade must reach Firestore — losing one means a card silently keeps an
// old due date. Firestore's offline cache already journals writes to IndexedDB
// and replays them on reconnect (so a pending write is safe, not lost), but a
// write can still be *rejected*. This queues those, retries with backoff, and
// reports status so the UI can say whether your progress is safely stored.

import { setSrsState } from "./firestore";
import type { SrsState } from "./srs";

export type SaveStatus = "saved" | "saving" | "offline" | "error";

interface PendingWrite {
  uid: string;
  deckId: string;
  key: string;
  state: SrsState;
  attempts: number;
  /** guards against a failed older write resurrecting stale state */
  seq: number;
}

export class SrsWriter {
  private pending = new Map<string, PendingWrite>();
  private latestSeq = new Map<string, number>();
  private seqCounter = 0;
  private inFlight = 0;
  private failed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private onStatus: (status: SaveStatus, pending: number) => void;

  constructor(onStatus: (status: SaveStatus, pending: number) => void) {
    this.onStatus = onStatus;
    window.addEventListener("online", this.retryAll);
  }

  dispose() {
    window.removeEventListener("online", this.retryAll);
    if (this.timer) clearTimeout(this.timer);
  }

  private retryAll = () => {
    this.failed = false;
    for (const write of [...this.pending.values()]) this.send(write);
    this.report();
  };

  private report() {
    const count = this.pending.size + this.inFlight;
    if (this.failed) this.onStatus("error", count);
    else if (count === 0) this.onStatus("saved", 0);
    else if (!navigator.onLine) this.onStatus("offline", count);
    else this.onStatus("saving", count);
  }

  private send(write: PendingWrite) {
    this.pending.delete(this.idOf(write));
    this.inFlight++;
    this.report();
    setSrsState(write.uid, write.deckId, write.key, write.state)
      .then(() => {
        this.inFlight--;
        this.report();
      })
      .catch(() => {
        this.inFlight--;
        const attempts = write.attempts + 1;
        const id = this.idOf(write);
        // Only retry if this is still the newest grade for the card — an older
        // failed write must never overwrite one the user gave afterwards.
        if (this.latestSeq.get(id) !== write.seq) {
          this.report();
          return;
        }
        this.pending.set(id, { ...write, attempts });
        if (attempts >= 6) {
          this.failed = true;
        } else {
          const delay = Math.min(1000 * 2 ** attempts, 30000);
          if (this.timer) clearTimeout(this.timer);
          this.timer = setTimeout(() => this.retryAll(), delay);
        }
        this.report();
      });
  }

  private idOf(w: { deckId: string; key: string }) {
    return `${w.deckId}|${w.key}`;
  }

  write(uid: string, deckId: string, key: string, state: SrsState) {
    const seq = ++this.seqCounter;
    this.latestSeq.set(this.idOf({ deckId, key }), seq);
    this.send({ uid, deckId, key, state, attempts: 0, seq });
  }

  /** True while anything is still on its way to the server. */
  get hasPending() {
    return this.pending.size + this.inFlight > 0;
  }
}
