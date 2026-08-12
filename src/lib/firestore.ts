import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  writeBatch,
  getDocs,
  getDoc,
  setDoc,
  getCountFromServer,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll,
} from "firebase/storage";
import { db, storage } from "../firebase";
import { normalizeCardData } from "./cloze";
import type { PlannerPlan, PlannerProgress } from "./planner";
import { DEFAULT_EMAIL_SETTINGS, type EmailSettings } from "./emailReminders";
import type { Card, CardData, Deck, OcclusionSheet, OcclusionShape } from "../types";

function toMillis(v: unknown): number {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === "number") return v;
  return Date.now();
}

// ---------- Decks ----------

export function decksCol(uid: string) {
  return collection(db, "users", uid, "decks");
}

function deckFromDoc(d: { id: string; data: () => Record<string, unknown> }): Deck {
  const data = d.data();
  return {
    id: d.id,
    name: data.name as string,
    subject: data.subject as string | undefined,
    color: (data.color as string) ?? "#6366f1",
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
    deletedAt: typeof data.deletedAt === "number" ? data.deletedAt : null,
    hiddenInQuizlet: Boolean(data.hiddenInQuizlet),
    hiddenInAnki: Boolean(data.hiddenInAnki),
  };
}

/** Active (non-trashed) decks. */
export function watchDecks(uid: string, cb: (decks: Deck[]) => void) {
  const q = query(decksCol(uid), orderBy("updatedAt", "desc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map(deckFromDoc).filter((d) => !d.deletedAt));
  });
}

/** Decks sitting in the trash. */
export function watchTrashedDecks(uid: string, cb: (decks: Deck[]) => void) {
  const q = query(decksCol(uid), orderBy("updatedAt", "desc"));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map(deckFromDoc).filter((d) => Boolean(d.deletedAt)));
  });
}

/** One-shot read of active decks (importers can't wait on a listener). */
export async function listDecksOnce(uid: string): Promise<Deck[]> {
  const snap = await getDocs(decksCol(uid));
  return snap.docs.map(deckFromDoc).filter((d) => !d.deletedAt);
}

export const TRASH_RETENTION_DAYS = 30;

/** Soft-delete: the deck moves to the trash; nothing else is touched. */
export async function trashDeck(uid: string, deckId: string) {
  await updateDoc(doc(db, "users", uid, "decks", deckId), {
    deletedAt: Date.now(),
  });
}

export async function restoreDeckFromTrash(uid: string, deckId: string) {
  await updateDoc(doc(db, "users", uid, "decks", deckId), {
    deletedAt: null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Hard-deletes every trashed deck older than the retention window (or all
 * trashed decks when force=true, i.e. "Empty trash"), including cards,
 * occlusion sheets, SRS state, and all Storage media — freeing storage.
 */
export async function purgeExpiredTrash(
  uid: string,
  force = false
): Promise<number> {
  const snap = await getDocs(decksCol(uid));
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let purged = 0;
  for (const d of snap.docs) {
    const deletedAt = d.data().deletedAt;
    if (typeof deletedAt !== "number") continue;
    if (force || deletedAt < cutoff) {
      await deleteDeck(uid, d.id);
      purged++;
    }
  }
  return purged;
}

export async function getDeck(uid: string, deckId: string): Promise<Deck | null> {
  const snap = await getDoc(doc(db, "users", uid, "decks", deckId));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    id: snap.id,
    name: data.name,
    subject: data.subject,
    color: data.color ?? "#6366f1",
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

export async function createDeck(
  uid: string,
  name: string,
  subject: string,
  color: string
) {
  const ref = await addDoc(decksCol(uid), {
    name,
    subject,
    color,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * Returns the deck at `path`, creating it (and any missing ancestors) if
 * needed — typing "Anatomy::Lab 3::Vasculature" in one go builds the chain,
 * just like Anki's Create Deck.
 */
export async function ensureDeckPath(
  uid: string,
  path: string,
  existing: Deck[],
  color = "#6366f1"
): Promise<string> {
  const { splitDeckPath, joinDeckPath, findDeckByPath } = await import("./deckPath");
  const segments = splitDeckPath(path);
  if (segments.length === 0) throw new Error("A deck needs a name.");

  const known = [...existing];
  let deckId = "";
  for (let i = 0; i < segments.length; i++) {
    const sub = joinDeckPath(segments.slice(0, i + 1));
    const found = findDeckByPath(known, sub);
    if (found) {
      deckId = found.id;
      continue;
    }
    deckId = await createDeck(uid, sub, "", color);
    known.push({
      id: deckId,
      name: sub,
      color,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  return deckId;
}

export async function updateDeck(
  uid: string,
  deckId: string,
  patch: Partial<
    Pick<Deck, "name" | "subject" | "color" | "hiddenInQuizlet" | "hiddenInAnki">
  >
) {
  await updateDoc(doc(db, "users", uid, "decks", deckId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Moves cards to another deck, carrying their scheduling with them. The card
 * gets a new id in the target, so SRS keys are rewritten to match.
 */
export async function moveCardsToDeck(
  uid: string,
  fromDeckId: string,
  toDeckId: string,
  cardIds: string[]
): Promise<void> {
  if (fromDeckId === toDeckId || cardIds.length === 0) return;
  const [cards, srs] = await Promise.all([
    getCardsOnce(uid, fromDeckId),
    getSrsMap(uid, fromDeckId),
  ]);
  const wanted = new Set(cardIds);
  for (const card of cards) {
    if (!wanted.has(card.id)) continue;
    const newRef = doc(cardsCol(uid, toDeckId));
    await setDoc(newRef, {
      data: card.data,
      tags: card.tags ?? [],
      importId: card.importId ?? null,
      stats: card.stats,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    // SRS docs are keyed cardId or cardId-cN — rewrite the prefix.
    for (const [key, state] of srs) {
      if (key === card.id || key.startsWith(`${card.id}-c`)) {
        const newKey = key.replace(card.id, newRef.id);
        await setSrsState(uid, toDeckId, newKey, state);
        await deleteSrsState(uid, fromDeckId, key);
      }
    }
    await deleteDoc(doc(db, "users", uid, "decks", fromDeckId, "cards", card.id));
  }
  await touchDeck(uid, toDeckId);
  await touchDeck(uid, fromDeckId);
}

/** Moves occlusion sheets (and their mask schedules) to another deck. */
export async function moveSheetsToDeck(
  uid: string,
  fromDeckId: string,
  toDeckId: string,
  sheetIds: string[]
): Promise<void> {
  if (fromDeckId === toDeckId || sheetIds.length === 0) return;
  const [sheets, srs] = await Promise.all([
    getOcclusionsOnce(uid, fromDeckId),
    getSrsMap(uid, fromDeckId),
  ]);
  const wanted = new Set(sheetIds);
  for (const sheet of sheets) {
    if (!wanted.has(sheet.id)) continue;
    const newId = await createOcclusionSheet(uid, toDeckId, {
      tags: sheet.tags ?? [],
      importId: sheet.importId,
      title: sheet.title,
      imagePath: sheet.imagePath,
      imageUrl: sheet.imageUrl,
      imageWidth: sheet.imageWidth,
      imageHeight: sheet.imageHeight,
      shapes: sheet.shapes,
      linkedImage: sheet.linkedImage,
    });
    for (const [key, state] of srs) {
      if (key.startsWith(`${sheet.id}-`)) {
        await setSrsState(uid, toDeckId, key.replace(sheet.id, newId), state);
        await deleteSrsState(uid, fromDeckId, key);
      }
    }
    // Delete the old doc only — the image now belongs to the moved sheet.
    await deleteDoc(
      doc(db, "users", uid, "decks", fromDeckId, "occlusions", sheet.id)
    );
  }
  await touchDeck(uid, toDeckId);
  await touchDeck(uid, fromDeckId);
}

/**
 * Copies a deck's cards into a new deck. Occlusion sheets are linked to the
 * same images rather than duplicated, so a copy costs no extra storage.
 */
export async function duplicateDeck(
  uid: string,
  deckId: string,
  newName: string,
  color: string
): Promise<string> {
  const [cards, sheets] = await Promise.all([
    getCardsOnce(uid, deckId),
    getOcclusionsOnce(uid, deckId),
  ]);
  const targetId = await createDeck(uid, newName, "", color);
  if (cards.length) {
    await createCardsBulk(
      uid,
      targetId,
      cards.map((c) => c.data),
      undefined,
      cards.map((c) => c.tags ?? [])
    );
  }
  for (const sheet of sheets) {
    await createOcclusionSheet(uid, targetId, {
      tags: sheet.tags ?? [],
      title: sheet.title,
      imagePath: sheet.imagePath,
      imageUrl: sheet.imageUrl,
      imageWidth: sheet.imageWidth,
      imageHeight: sheet.imageHeight,
      shapes: sheet.shapes,
      linkedImage: true,
    });
  }
  return targetId;
}

export async function deleteDeck(uid: string, deckId: string) {
  // Clean up subcollections + storage first.
  const cardsSnap = await getDocs(collection(db, "users", uid, "decks", deckId, "cards"));
  const occSnap = await getDocs(collection(db, "users", uid, "decks", deckId, "occlusions"));
  const srsSnap = await getDocs(collection(db, "users", uid, "decks", deckId, "srs"));
  const revSnap = await getDocs(collection(db, "users", uid, "decks", deckId, "revlog"));

  // The review log can outgrow a single 500-op batch, so delete in chunks.
  const refs = [
    ...cardsSnap.docs.map((d) => d.ref),
    ...occSnap.docs.map((d) => d.ref),
    ...srsSnap.docs.map((d) => d.ref),
    ...revSnap.docs.map((d) => d.ref),
  ];
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
  await deleteDoc(doc(db, "users", uid, "decks", deckId));

  await Promise.all(
    occSnap.docs.map(async (d) => {
      const data = d.data();
      const path = data.imagePath as string | undefined;
      // Skip images owned by a lecture note (see deleteOcclusionSheet).
      if (path && !data.linkedImage) {
        try {
          await deleteObject(ref(storage, path));
        } catch {
          /* image may already be gone */
        }
      }
    })
  );

  // Clean up any card-embedded media uploaded for this deck.
  try {
    const mediaDir = await listAll(
      ref(storage, `users/${uid}/decks/${deckId}/media`)
    );
    await Promise.all(mediaDir.items.map((item) => deleteObject(item).catch(() => {})));
  } catch {
    /* folder may not exist */
  }
}

// ---------- Cards (basic + cloze) ----------

export function cardsCol(uid: string, deckId: string) {
  return collection(db, "users", uid, "decks", deckId, "cards");
}

export function watchCards(
  uid: string,
  deckId: string,
  cb: (cards: Card[]) => void
) {
  const q = query(cardsCol(uid, deckId), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    cb(
      snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          tags: (data.tags as string[] | undefined) ?? [],
          starred: Boolean(data.starred),
          createdAt: toMillis(data.createdAt),
          updatedAt: toMillis(data.updatedAt),
          stats: data.stats ?? { correct: 0, incorrect: 0 },
          // Cards imported before cloze detection looked at the content are
          // stored as basic with the markup intact; read them as what they are.
          data: normalizeCardData(data.data as CardData),
        } as Card;
      })
    );
  });
}

export async function getCardsOnce(uid: string, deckId: string): Promise<Card[]> {
  const snap = await getDocs(cardsCol(uid, deckId));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      importId: data.importId as string | undefined,
      tags: (data.tags as string[] | undefined) ?? [],
      starred: Boolean(data.starred),
      createdAt: toMillis(data.createdAt),
      updatedAt: toMillis(data.updatedAt),
      stats: data.stats ?? { correct: 0, incorrect: 0 },
      data: normalizeCardData(data.data as CardData),
    } as Card;
  });
}

export async function getOcclusionsOnce(
  uid: string,
  deckId: string
): Promise<OcclusionSheet[]> {
  const snap = await getDocs(occlusionsCol(uid, deckId));
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      importId: data.importId as string | undefined,
      tags: (data.tags as string[] | undefined) ?? [],
      starred: Boolean(data.starred),
      revealMode: data.revealMode as OcclusionSheet["revealMode"],
      title: data.title ?? "Untitled",
      imagePath: data.imagePath,
      imageUrl: data.imageUrl,
      imageWidth: data.imageWidth,
      imageHeight: data.imageHeight,
      shapes: data.shapes ?? [],
      linkedImage: Boolean(data.linkedImage),
      createdAt: toMillis(data.createdAt),
      updatedAt: toMillis(data.updatedAt),
    } as OcclusionSheet;
  });
}

export async function createCard(
  uid: string,
  deckId: string,
  data: CardData,
  tags: string[] = []
) {
  await addDoc(cardsCol(uid, deckId), {
    data,
    tags,
    stats: { correct: 0, incorrect: 0 },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await touchDeck(uid, deckId);
}

/** Returns the new card ids, in the same order as `items`. */
export async function createCardsBulk(
  uid: string,
  deckId: string,
  items: CardData[],
  importIds?: (string | undefined)[],
  tagsPerItem?: (string[] | undefined)[]
): Promise<string[]> {
  // Firestore hard-limits a batch to 500 operations, so commit in chunks.
  const col = cardsCol(uid, deckId);
  const CHUNK = 400;
  const ids: string[] = [];
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = writeBatch(db);
    items.slice(i, i + CHUNK).forEach((data, j) => {
      const ref = doc(col);
      ids.push(ref.id);
      batch.set(ref, {
        data,
        importId: importIds?.[i + j] ?? null,
        tags: tagsPerItem?.[i + j] ?? [],
        stats: { correct: 0, incorrect: 0 },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
  await touchDeck(uid, deckId);
  return ids;
}

export async function updateCard(
  uid: string,
  deckId: string,
  cardId: string,
  data: CardData
) {
  await updateDoc(doc(db, "users", uid, "decks", deckId, "cards", cardId), {
    data,
    updatedAt: serverTimestamp(),
  });
}

export async function recordCardResult(
  uid: string,
  deckId: string,
  cardId: string,
  correct: boolean,
  stats: { correct: number; incorrect: number }
) {
  await updateDoc(doc(db, "users", uid, "decks", deckId, "cards", cardId), {
    stats: {
      correct: stats.correct + (correct ? 1 : 0),
      incorrect: stats.incorrect + (correct ? 0 : 1),
    },
  });
}

export async function deleteCard(uid: string, deckId: string, cardId: string) {
  await deleteDoc(doc(db, "users", uid, "decks", deckId, "cards", cardId));
}

async function touchDeck(uid: string, deckId: string) {
  await updateDoc(doc(db, "users", uid, "decks", deckId), {
    updatedAt: serverTimestamp(),
  });
}

// ---------- Lecture notes ----------

import type { Note, NoteSlide } from "../types";

function notesCol(uid: string) {
  return collection(db, "users", uid, "notes");
}

function noteFromDoc(d: { id: string; data: () => Record<string, unknown> }): Note {
  const data = d.data();
  return {
    id: d.id,
    title: (data.title as string) ?? "Untitled",
    className: (data.className as string) ?? "",
    content: (data.content as string) ?? "",
    slides: (data.slides as NoteSlide[]) ?? [],
    cardsMade: (data.cardsMade as number) ?? 0,
    lastSubdeck: (data.lastSubdeck as string) ?? "",
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

export function watchNotes(uid: string, cb: (notes: Note[]) => void) {
  const q = query(notesCol(uid), orderBy("updatedAt", "desc"));
  return onSnapshot(q, (snap) => cb(snap.docs.map(noteFromDoc)));
}

export async function getNote(uid: string, noteId: string): Promise<Note | null> {
  const snap = await getDoc(doc(db, "users", uid, "notes", noteId));
  return snap.exists() ? noteFromDoc(snap) : null;
}

export async function createNote(
  uid: string,
  title: string,
  className: string
): Promise<string> {
  const docRef = await addDoc(notesCol(uid), {
    title,
    className,
    content: "",
    slides: [],
    cardsMade: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function updateNote(
  uid: string,
  noteId: string,
  updates: Partial<
    Pick<
      Note,
      "title" | "className" | "content" | "slides" | "cardsMade" | "lastSubdeck"
    >
  >
) {
  await updateDoc(doc(db, "users", uid, "notes", noteId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteNote(uid: string, noteId: string, slides: NoteSlide[]) {
  // Sweep the note's whole storage folder rather than just slides[], so
  // images pasted into the body don't linger and cost storage forever.
  try {
    const dir = await listAll(ref(storage, `users/${uid}/notes/${noteId}`));
    await Promise.all([
      ...dir.items.map((item) => deleteObject(item).catch(() => {})),
      ...dir.prefixes.map(async (folder) => {
        const inner = await listAll(folder);
        await Promise.all(inner.items.map((i) => deleteObject(i).catch(() => {})));
      }),
    ]);
  } catch {
    // Listing can fail offline — fall back to the paths we know about.
    await Promise.all(
      slides.map((s) => deleteObject(ref(storage, s.imagePath)).catch(() => {}))
    );
  }
  await deleteDoc(doc(db, "users", uid, "notes", noteId));
}

/** Removes specific slide images (used when replacing a lecture's slides). */
export async function deleteNoteSlideFiles(paths: string[]) {
  await Promise.all(
    paths.map((p) => deleteObject(ref(storage, p)).catch(() => {}))
  );
}

/** Uploads a rendered slide, or any image pasted/inserted into a note. */
export async function uploadNoteSlide(
  uid: string,
  noteId: string,
  blob: Blob
): Promise<{ path: string; url: string }> {
  const contentType = blob.type && blob.type.startsWith("image/")
    ? blob.type
    : "image/png";
  const ext = contentType.split("/")[1]?.split("+")[0] || "png";
  const path = `users/${uid}/notes/${noteId}/slides/${newId()}.${ext}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob, { contentType });
  const url = await getDownloadURL(storageRef);
  return { path, url };
}

/**
 * Looks up existing cards by their import identity, in `in` batches of 30.
 * Re-importing a growing deck only needs to ask about the notes actually in
 * the package, instead of reading every card in the deck.
 */
export async function findCardsByImportIds(
  uid: string,
  deckId: string,
  importIds: string[]
): Promise<Map<string, { id: string; tags: string[] }>> {
  const found = new Map<string, { id: string; tags: string[] }>();
  const unique = [...new Set(importIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const snap = await getDocs(
      query(cardsCol(uid, deckId), where("importId", "in", chunk))
    );
    for (const d of snap.docs) {
      const data = d.data();
      found.set(String(data.importId), {
        id: d.id,
        tags: (data.tags as string[] | undefined) ?? [],
      });
    }
  }
  return found;
}

/** Same targeted lookup for occlusion sheets. */
export async function findSheetsByImportIds(
  uid: string,
  deckId: string,
  importIds: string[]
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const unique = [...new Set(importIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 30) {
    const chunk = unique.slice(i, i + 30);
    const snap = await getDocs(
      query(occlusionsCol(uid, deckId), where("importId", "in", chunk))
    );
    for (const d of snap.docs) {
      found.set(String(d.data().importId), d.id);
    }
  }
  return found;
}

/**
 * Counts items in a deck that predate import ids.
 *
 * Re-import matches on import id, which is cheap. Falling back to a full
 * content scan is only justified when the deck actually holds items an id
 * lookup can never find — two aggregate queries answer that without reading
 * a single document.
 */
export async function countItemsWithoutImportId(
  uid: string,
  deckId: string
): Promise<number> {
  let missing = 0;
  for (const col of [cardsCol(uid, deckId), occlusionsCol(uid, deckId)]) {
    // `!=` excludes documents where the field is absent, which is exactly
    // what "written before import ids" looks like.
    const [total, withIds] = await Promise.all([
      getCountFromServer(col),
      getCountFromServer(query(col, where("importId", "!=", null))),
    ]);
    missing += total.data().count - withIds.data().count;
  }
  return missing;
}

/**
 * Stars (or unstars) a card or sheet. It lives on the note itself rather than
 * on a study session, so a note starred while cramming one deck is still
 * starred when you study its subdeck on another device.
 */
export async function setItemStarred(
  uid: string,
  deckId: string,
  kind: "card" | "sheet",
  itemId: string,
  starred: boolean
) {
  const col = kind === "card" ? "cards" : "occlusions";
  await updateDoc(doc(db, "users", uid, "decks", deckId, col, itemId), {
    starred,
    updatedAt: serverTimestamp(),
  });
}

/** Replaces a card's or sheet's tag list. */
export async function setItemTags(
  uid: string,
  deckId: string,
  kind: "card" | "sheet",
  itemId: string,
  tags: string[]
) {
  const col = kind === "card" ? "cards" : "occlusions";
  await updateDoc(doc(db, "users", uid, "decks", deckId, col, itemId), {
    tags,
    updatedAt: serverTimestamp(),
  });
}

// ---------- Quizlet cram progress (cross-device) ----------
// A cram run is throwaway compared to the SRS schedule, but it has to survive
// a refresh, a closed tab, and moving to another device — losing your place
// halfway through a deck is the thing that makes people start over. The doc is
// deleted the moment the deck is finished, so nothing accumulates.

export interface CramProgressDoc {
  order: string[];
  strengths: [string, number][];
  misses?: [string, number][];
  total: number;
  savedAt: number;
}

function cramDoc(uid: string, id: string) {
  return doc(db, "users", uid, "cram", id);
}

export async function saveCramProgress(
  uid: string,
  id: string,
  data: CramProgressDoc
) {
  await setDoc(cramDoc(uid, id), { ...data, updatedAt: serverTimestamp() });
}

export async function fetchCramProgress(
  uid: string,
  id: string
): Promise<CramProgressDoc | null> {
  const snap = await getDoc(cramDoc(uid, id));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<CramProgressDoc>;
  if (!Array.isArray(data.order) || data.order.length === 0) return null;
  return {
    order: data.order,
    strengths: (data.strengths ?? []) as [string, number][],
    misses: (data.misses ?? []) as [string, number][],
    total: data.total ?? data.order.length,
    savedAt: data.savedAt ?? 0,
  };
}

export async function deleteCramProgress(uid: string, id: string) {
  await deleteDoc(cramDoc(uid, id));
}

/**
 * The cards a finished run left you struggling with. Outlives the session it
 * came from — that's the point — but it's only a list of ids, so it costs
 * almost nothing, and it's deleted as soon as you clear them.
 */
function troubleDoc(uid: string, id: string) {
  return doc(db, "users", uid, "cramReview", id);
}

export async function saveTroubleList(uid: string, id: string, keys: string[]) {
  await setDoc(troubleDoc(uid, id), {
    keys,
    savedAt: Date.now(),
    updatedAt: serverTimestamp(),
  });
}

export async function fetchTroubleList(
  uid: string,
  id: string
): Promise<{ keys: string[]; savedAt: number } | null> {
  const snap = await getDoc(troubleDoc(uid, id));
  if (!snap.exists()) return null;
  const data = snap.data() as { keys?: string[]; savedAt?: number };
  if (!Array.isArray(data.keys) || data.keys.length === 0) return null;
  return { keys: data.keys, savedAt: data.savedAt ?? 0 };
}

export async function deleteTroubleList(uid: string, id: string) {
  await deleteDoc(troubleDoc(uid, id));
}

// ---------- Academic planner ----------
// The semester and the routine live in one document — they change only on
// import. Ticks live in another as a flat map, so marking one box off is a
// single small write rather than a rewrite of the whole term.

export async function fetchPlannerPlan(
  uid: string
): Promise<PlannerPlan | null> {
  const snap = await getDoc(doc(db, "users", uid, "planner", "plan"));
  return snap.exists() ? (snap.data() as PlannerPlan) : null;
}

export async function savePlannerPlan(uid: string, plan: PlannerPlan) {
  await setDoc(doc(db, "users", uid, "planner", "plan"), {
    ...plan,
    updatedAt: Date.now(),
  });
}

export async function fetchPlannerProgress(
  uid: string
): Promise<PlannerProgress> {
  const snap = await getDoc(doc(db, "users", uid, "planner", "progress"));
  if (!snap.exists()) return {};
  return ((snap.data() as { done?: PlannerProgress }).done ?? {}) as PlannerProgress;
}

/**
 * Ticks or unticks one box. setDoc with merge rather than updateDoc so the
 * very first tick doesn't fail on a document that doesn't exist yet.
 */
export async function setPlannerProgress(
  uid: string,
  key: string,
  done: boolean
) {
  await setDoc(
    doc(db, "users", uid, "planner", "progress"),
    { done: { [key]: done } },
    { merge: true }
  );
}

/** Used when a whole session's routine is ticked at once. */
export async function setPlannerProgressBulk(
  uid: string,
  entries: Record<string, boolean>
) {
  await setDoc(
    doc(db, "users", uid, "planner", "progress"),
    { done: entries },
    { merge: true }
  );
}

// ---------- Email reminders ----------
// These live in a top-level collection rather than under users/{uid} because
// the sender has to find everyone with reminders due without walking every
// account. The rules still limit each document to its owner; the sender uses
// a service account, which is the only thing that reads across users.

export async function fetchEmailSettings(
  uid: string
): Promise<EmailSettings | null> {
  const snap = await getDoc(doc(db, "emailReminders", uid));
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<EmailSettings>;
  // Merged over the defaults so a document written by an older version of
  // the app can't leave a field undefined.
  return {
    ...DEFAULT_EMAIL_SETTINGS,
    ...data,
    daily: { ...DEFAULT_EMAIL_SETTINGS.daily, ...(data.daily ?? {}) },
    weekly: { ...DEFAULT_EMAIL_SETTINGS.weekly, ...(data.weekly ?? {}) },
    exam: { ...DEFAULT_EMAIL_SETTINGS.exam, ...(data.exam ?? {}) },
    custom: data.custom ?? [],
    sent: data.sent ?? {},
  };
}

export async function saveEmailSettings(uid: string, settings: EmailSettings) {
  // merge:true so the sender's `sent` bookkeeping isn't wiped by someone
  // saving their settings from another tab.
  const { sent: _ignored, ...editable } = settings;
  await setDoc(
    doc(db, "emailReminders", uid),
    { ...editable, uid, updatedAt: Date.now() },
    { merge: true }
  );
}

// ---------- User settings (cross-device) ----------

export async function fetchUserSettings(
  uid: string
): Promise<{ anki?: unknown; quizlet?: unknown } | null> {
  const snap = await getDoc(doc(db, "users", uid, "meta", "settings"));
  return snap.exists() ? (snap.data() as { anki?: unknown; quizlet?: unknown }) : null;
}

export async function saveUserSettings(
  uid: string,
  settings: { anki: unknown; quizlet: unknown }
) {
  await setDoc(doc(db, "users", uid, "meta", "settings"), {
    ...settings,
    updatedAt: serverTimestamp(),
  });
}

// ---------- Review log ----------
// One entry per Anki-mode answer, like Anki's revlog table. Powers the
// Again/First review/Rescheduled filters in Browse and, later, FSRS
// parameter optimization — which is why it also records duration and phase.

export type ReviewLogRating = "again" | "hard" | "good" | "easy" | "rescheduled";

export interface ReviewLogEntry {
  itemKey: string;
  rating: ReviewLogRating;
  /** epoch ms of the answer */
  at: number;
  /** how long the card was on screen before answering */
  durMs: number;
  /** card phase when the answer was given */
  phase: "learn" | "review" | "relearn" | "new";
  /** true when this was the card's first-ever grade */
  firstReview: boolean;
}

function revlogCol(uid: string, deckId: string) {
  return collection(db, "users", uid, "decks", deckId, "revlog");
}

export async function logReview(
  uid: string,
  deckId: string,
  entry: ReviewLogEntry
) {
  await addDoc(revlogCol(uid, deckId), entry);
}

/** Today's log entries across decks, keyed `${deckId}|${itemKey}`. */
export async function getTodayRevlog(
  uid: string,
  deckIds: string[],
  dayStart: number
): Promise<Map<string, ReviewLogEntry[]>> {
  const out = new Map<string, ReviewLogEntry[]>();
  await Promise.all(
    deckIds.map(async (deckId) => {
      const snap = await getDocs(
        query(revlogCol(uid, deckId), where("at", ">=", dayStart))
      );
      for (const d of snap.docs) {
        const entry = d.data() as ReviewLogEntry;
        const key = `${deckId}|${entry.itemKey}`;
        const list = out.get(key) ?? [];
        list.push(entry);
        out.set(key, list);
      }
    })
  );
  return out;
}

// ---------- Spaced repetition state ----------
// One doc per study item (basic card / cloze deletion / occlusion unit),
// keyed by the item's stable key. Only Anki-mode grading writes here, so
// Quizlet-mode cramming never disturbs the schedule.

import type { SrsState } from "./srs";
import { uid as newId } from "./uid";

function srsKeyToDocId(itemKey: string): string {
  return itemKey.replace(/[/]/g, "_");
}

export async function getSrsMap(
  uid: string,
  deckId: string
): Promise<Map<string, SrsState>> {
  const snap = await getDocs(collection(db, "users", uid, "decks", deckId, "srs"));
  const map = new Map<string, SrsState>();
  for (const d of snap.docs) {
    map.set(d.id, d.data() as SrsState);
  }
  return map;
}

export async function setSrsState(
  uid: string,
  deckId: string,
  itemKey: string,
  state: SrsState
) {
  await setDoc(
    doc(db, "users", uid, "decks", deckId, "srs", srsKeyToDocId(itemKey)),
    state
  );
}

/** Removes all scheduling for an item — it becomes a brand-new card. */
export async function deleteSrsState(uid: string, deckId: string, itemKey: string) {
  await deleteDoc(
    doc(db, "users", uid, "decks", deckId, "srs", srsKeyToDocId(itemKey))
  );
}

// ---------- Image Occlusion sheets ----------

export function occlusionsCol(uid: string, deckId: string) {
  return collection(db, "users", uid, "decks", deckId, "occlusions");
}

export function watchOcclusions(
  uid: string,
  deckId: string,
  cb: (sheets: OcclusionSheet[]) => void
) {
  const q = query(occlusionsCol(uid, deckId), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    cb(
      snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          tags: (data.tags as string[] | undefined) ?? [],
          starred: Boolean(data.starred),
          revealMode: data.revealMode as OcclusionSheet["revealMode"],
          title: data.title ?? "Untitled",
          imagePath: data.imagePath,
          imageUrl: data.imageUrl,
          imageWidth: data.imageWidth,
          imageHeight: data.imageHeight,
          shapes: data.shapes ?? [],
          linkedImage: Boolean(data.linkedImage),
          createdAt: toMillis(data.createdAt),
          updatedAt: toMillis(data.updatedAt),
        } as OcclusionSheet;
      })
    );
  });
}

export async function getOcclusionSheet(
  uid: string,
  deckId: string,
  sheetId: string
): Promise<OcclusionSheet | null> {
  const snap = await getDoc(
    doc(db, "users", uid, "decks", deckId, "occlusions", sheetId)
  );
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    id: snap.id,
    title: data.title ?? "Untitled",
    imagePath: data.imagePath,
    imageUrl: data.imageUrl,
    imageWidth: data.imageWidth,
    imageHeight: data.imageHeight,
    shapes: data.shapes ?? [],
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

const EXT_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
};

export function contentTypeForFilename(name: string): string | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_CONTENT_TYPES[ext] ?? null;
}

/** Uploads a card-embedded media image (from an Anki package) for a deck. */
export async function uploadDeckMedia(
  uid: string,
  deckId: string,
  filename: string,
  bytes: Uint8Array
): Promise<{ path: string; url: string }> {
  const contentType = contentTypeForFilename(filename);
  if (!contentType) {
    throw new Error(`Unsupported media type: ${filename}`);
  }
  const ext = filename.split(".").pop() || "png";
  const path = `users/${uid}/decks/${deckId}/media/${newId()}.${ext}`;
  const storageRef = ref(storage, path);
  // Upload the view directly — copying it first would double peak memory
  // on a package full of images.
  await uploadBytes(storageRef, bytes as unknown as Uint8Array<ArrayBuffer>, {
    contentType,
  });
  const url = await getDownloadURL(storageRef);
  return { path, url };
}

export async function uploadOcclusionImage(
  uid: string,
  deckId: string,
  file: File
): Promise<{ path: string; url: string }> {
  const ext = file.name.split(".").pop() || "png";
  const path = `users/${uid}/decks/${deckId}/occlusions/${newId()}.${ext}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type });
  const url = await getDownloadURL(storageRef);
  return { path, url };
}

export async function createOcclusionSheet(
  uid: string,
  deckId: string,
  sheet: {
    title: string;
    imagePath: string;
    imageUrl: string;
    imageWidth: number;
    imageHeight: number;
    shapes: OcclusionShape[];
    linkedImage?: boolean;
    importId?: string;
    tags?: string[];
    revealMode?: OcclusionSheet["revealMode"];
  }
) {
  const ref = await addDoc(occlusionsCol(uid, deckId), {
    ...sheet,
    tags: sheet.tags ?? [],
    importId: sheet.importId ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await touchDeck(uid, deckId);
  return ref.id;
}

export async function updateOcclusionSheet(
  uid: string,
  deckId: string,
  sheetId: string,
  patch: Partial<
    Pick<OcclusionSheet, "title" | "shapes" | "revealMode">
  >
) {
  await updateDoc(
    doc(db, "users", uid, "decks", deckId, "occlusions", sheetId),
    { ...patch, updatedAt: serverTimestamp() }
  );
}

export async function deleteOcclusionSheet(
  uid: string,
  deckId: string,
  sheetId: string,
  imagePath: string,
  linkedImage = false
) {
  await deleteDoc(doc(db, "users", uid, "decks", deckId, "occlusions", sheetId));
  // A linked image belongs to a lecture note — removing it here would tear a
  // slide out of that note, so only delete files this sheet actually owns.
  if (linkedImage) return;
  try {
    await deleteObject(ref(storage, imagePath));
  } catch {
    /* already gone */
  }
}
