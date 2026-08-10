// Undo/redo for a contenteditable.
//
// document.execCommand("undo") is deprecated, differs between browsers, and
// stops working entirely once anything writes to the DOM outside the browser's
// own editing commands — which this editor does constantly (cloze insertion,
// checklists, pasted images). Losing a paragraph and finding Ctrl+Z does
// nothing is exactly the sort of thing that costs someone a lecture, so the
// history is kept explicitly instead.
//
// Snapshots are whole-document HTML plus a caret position. That is more memory
// than a diff, but it is simple enough to be obviously correct, and the cap
// keeps it bounded.

export interface Snapshot {
  html: string;
  /** caret position as a character offset into the text, or null if unfocused */
  caret: number | null;
}

/** Most steps kept. Beyond this the oldest are dropped. */
const MAX_ENTRIES = 150;
/** Total characters of HTML kept before older steps are dropped. */
const MAX_CHARS = 4_000_000;

export class EditorHistory {
  private entries: Snapshot[] = [];
  private index = -1;

  constructor(initial: Snapshot) {
    this.entries = [initial];
    this.index = 0;
  }

  get current(): Snapshot {
    return this.entries[this.index];
  }
  get canUndo(): boolean {
    return this.index > 0;
  }
  get canRedo(): boolean {
    return this.index < this.entries.length - 1;
  }

  /**
   * Records a new state. Returns false when nothing changed, so callers can
   * skip the work — input fires for plenty of things that don't alter the
   * document (arrow keys through an IME, for one).
   */
  push(snapshot: Snapshot): boolean {
    if (snapshot.html === this.current?.html) {
      // Same text: just keep the caret fresh so undo returns you somewhere
      // sensible rather than to wherever you last changed something.
      if (this.current) this.current.caret = snapshot.caret;
      return false;
    }
    // Anything that was undone is now overwritten by this new branch.
    this.entries.length = this.index + 1;
    this.entries.push(snapshot);
    this.index = this.entries.length - 1;
    this.trim();
    return true;
  }

  /**
   * Replaces the newest state without adding a step. Used to keep the caret
   * of the state you're about to leave, so redo comes back to the right spot.
   */
  amendCaret(caret: number | null) {
    if (this.current) this.current.caret = caret;
  }

  undo(): Snapshot | null {
    if (!this.canUndo) return null;
    this.index -= 1;
    return this.current;
  }

  redo(): Snapshot | null {
    if (!this.canRedo) return null;
    this.index += 1;
    return this.current;
  }

  private trim() {
    while (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
      this.index -= 1;
    }
    let total = this.entries.reduce((n, e) => n + e.html.length, 0);
    // Never drop so much that the current state goes with it.
    while (total > MAX_CHARS && this.index > 1) {
      total -= this.entries[0].html.length;
      this.entries.shift();
      this.index -= 1;
    }
  }
}

// ---------- caret bookkeeping ----------
// Offsets are counted in characters of rendered text, which survives the
// document being rebuilt from an HTML string — node identity does not.

export function caretOffset(root: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.endContainer)) return null;
  const measure = range.cloneRange();
  measure.selectNodeContents(root);
  measure.setEnd(range.endContainer, range.endOffset);
  return measure.toString().length;
}

/**
 * Finds the text node and offset within it that a character offset lands on.
 * Separate from the selection work so the arithmetic — which is where the
 * bugs live — can be tested without a browser.
 *
 * Returns null when the offset is past the end of the text, which happens
 * whenever the state being restored was longer than what is on screen.
 */
export function locateOffset(
  root: HTMLElement,
  offset: number
): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node = walker.nextNode();
  while (node) {
    const len = node.nodeValue?.length ?? 0;
    if (remaining <= len) {
      return { node, offset: Math.max(0, Math.min(remaining, len)) };
    }
    remaining -= len;
    node = walker.nextNode();
  }
  return null;
}

export function restoreCaret(root: HTMLElement, offset: number | null) {
  if (offset === null) return;
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const spot = locateOffset(root, offset);
  if (spot) {
    range.setStart(spot.node, spot.offset);
    range.collapse(true);
  } else {
    // The text shrank. Sit at the end rather than nowhere at all.
    range.selectNodeContents(root);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}
