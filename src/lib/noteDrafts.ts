// Crash-proof local drafts for lecture notes.
//
// Losing an hour of typed lecture notes is the worst thing this app could do,
// so what you type is written to localStorage on the same tick as the
// keystroke — synchronously, before any network work is even scheduled.
//
// That matters because every other layer is asynchronous and can be cut off
// mid-flight: a debounced save hasn't fired yet, a Firestore write is still in
// the air, the browser kills the tab during `beforeunload`, or IndexedDB isn't
// available at all (Safari private browsing). localStorage is the one write
// that has already finished by the time the function returns.
//
// The draft is deleted only once the server has actually confirmed the note,
// so a draft existing always means "this might not be saved yet".

import type { Note } from "../types";

const PREFIX = "noteDraft:";
/** Drafts older than this are stale beyond usefulness. */
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

export interface NoteDraft {
  noteId: string;
  title: string;
  className: string;
  content: string;
  slides: Note["slides"];
  /** local clock, when the draft was written */
  savedAt: number;
}

function keyFor(noteId: string): string {
  return PREFIX + noteId;
}

/**
 * Records the current state of a note. Synchronous and best-effort: a failure
 * here must never interrupt typing, but it is reported so the UI can stop
 * claiming the work is safe.
 */
export function saveDraft(noteId: string, note: Note): boolean {
  try {
    const draft: NoteDraft = {
      noteId,
      title: note.title,
      className: note.className,
      content: note.content,
      slides: note.slides,
      savedAt: Date.now(),
    };
    localStorage.setItem(keyFor(noteId), JSON.stringify(draft));
    return true;
  } catch {
    // Quota exceeded, or storage blocked. Drop the oldest drafts and retry
    // once — this note matters more than someone else's month-old one.
    try {
      pruneOldDrafts(noteId);
      localStorage.setItem(
        keyFor(noteId),
        JSON.stringify({
          noteId,
          title: note.title,
          className: note.className,
          content: note.content,
          slides: note.slides,
          savedAt: Date.now(),
        })
      );
      return true;
    } catch {
      return false;
    }
  }
}

export function loadDraft(noteId: string): NoteDraft | null {
  try {
    const raw = localStorage.getItem(keyFor(noteId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as NoteDraft;
    if (typeof draft?.content !== "string" || typeof draft.savedAt !== "number") {
      return null;
    }
    if (Date.now() - draft.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(keyFor(noteId));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

/** Called only after the server has confirmed the note is stored. */
export function clearDraft(noteId: string) {
  try {
    localStorage.removeItem(keyFor(noteId));
  } catch {
    /* ignore */
  }
}

/** Everything except `keep`, oldest first, to free room. */
function pruneOldDrafts(keep: string) {
  const drafts: { key: string; savedAt: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX) || key === keyFor(keep)) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "{}");
      drafts.push({ key, savedAt: parsed.savedAt ?? 0 });
    } catch {
      drafts.push({ key, savedAt: 0 });
    }
  }
  drafts.sort((a, b) => a.savedAt - b.savedAt);
  for (const { key } of drafts) {
    localStorage.removeItem(key);
    // Only free as much as needed; the rest are somebody's work too.
    try {
      localStorage.setItem("__draftProbe", "1");
      localStorage.removeItem("__draftProbe");
      return;
    } catch {
      /* still full — keep going */
    }
  }
}

/**
 * Whether a draft holds work the stored note doesn't. Content decides, not
 * the clock alone: an identical draft is just a leftover, and a draft older
 * than the stored note means another device saved after this one was written.
 */
export function draftIsUnsaved(draft: NoteDraft, stored: Note): boolean {
  const same =
    draft.content === stored.content &&
    draft.title === stored.title &&
    draft.className === stored.className &&
    JSON.stringify(draft.slides) === JSON.stringify(stored.slides);
  if (same) return false;
  return draft.savedAt > stored.updatedAt;
}
