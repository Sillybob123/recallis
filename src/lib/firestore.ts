import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
  writeBatch,
  getDocs,
  getDoc,
  setDoc,
} from "firebase/firestore";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll,
} from "firebase/storage";
import { db, storage } from "../firebase";
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

export async function updateDeck(
  uid: string,
  deckId: string,
  patch: Partial<Pick<Deck, "name" | "subject" | "color">>
) {
  await updateDoc(doc(db, "users", uid, "decks", deckId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteDeck(uid: string, deckId: string) {
  // Clean up subcollections + storage first.
  const cardsSnap = await getDocs(collection(db, "users", uid, "decks", deckId, "cards"));
  const occSnap = await getDocs(collection(db, "users", uid, "decks", deckId, "occlusions"));
  const srsSnap = await getDocs(collection(db, "users", uid, "decks", deckId, "srs"));

  const batch = writeBatch(db);
  cardsSnap.docs.forEach((d) => batch.delete(d.ref));
  occSnap.docs.forEach((d) => batch.delete(d.ref));
  srsSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, "users", uid, "decks", deckId));
  await batch.commit();

  await Promise.all(
    occSnap.docs.map(async (d) => {
      const path = d.data().imagePath as string | undefined;
      if (path) {
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
          createdAt: toMillis(data.createdAt),
          updatedAt: toMillis(data.updatedAt),
          stats: data.stats ?? { correct: 0, incorrect: 0 },
          data: data.data as CardData,
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
      createdAt: toMillis(data.createdAt),
      updatedAt: toMillis(data.updatedAt),
      stats: data.stats ?? { correct: 0, incorrect: 0 },
      data: data.data as CardData,
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
      title: data.title ?? "Untitled",
      imagePath: data.imagePath,
      imageUrl: data.imageUrl,
      imageWidth: data.imageWidth,
      imageHeight: data.imageHeight,
      shapes: data.shapes ?? [],
      createdAt: toMillis(data.createdAt),
      updatedAt: toMillis(data.updatedAt),
    } as OcclusionSheet;
  });
}

export async function createCard(uid: string, deckId: string, data: CardData) {
  await addDoc(cardsCol(uid, deckId), {
    data,
    stats: { correct: 0, incorrect: 0 },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await touchDeck(uid, deckId);
}

export async function createCardsBulk(
  uid: string,
  deckId: string,
  items: CardData[]
) {
  // Firestore hard-limits a batch to 500 operations, so commit in chunks.
  const col = cardsCol(uid, deckId);
  const CHUNK = 400;
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const data of items.slice(i, i + CHUNK)) {
      const ref = doc(col);
      batch.set(ref, {
        data,
        stats: { correct: 0, incorrect: 0 },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }
  await touchDeck(uid, deckId);
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function updateNote(
  uid: string,
  noteId: string,
  updates: Partial<Pick<Note, "title" | "className" | "content" | "slides">>
) {
  await updateDoc(doc(db, "users", uid, "notes", noteId), {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteNote(uid: string, noteId: string, slides: NoteSlide[]) {
  await Promise.all(
    slides.map((s) => deleteObject(ref(storage, s.imagePath)).catch(() => {}))
  );
  await deleteDoc(doc(db, "users", uid, "notes", noteId));
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
  const path = `users/${uid}/notes/${noteId}/slides/${crypto.randomUUID()}.${ext}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, blob, { contentType });
  const url = await getDownloadURL(storageRef);
  return { path, url };
}

// ---------- Spaced repetition state ----------
// One doc per study item (basic card / cloze deletion / occlusion unit),
// keyed by the item's stable key. Only Anki-mode grading writes here, so
// Quizlet-mode cramming never disturbs the schedule.

import type { SrsState } from "./srs";

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
          title: data.title ?? "Untitled",
          imagePath: data.imagePath,
          imageUrl: data.imageUrl,
          imageWidth: data.imageWidth,
          imageHeight: data.imageHeight,
          shapes: data.shapes ?? [],
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
  const path = `users/${uid}/decks/${deckId}/media/${crypto.randomUUID()}.${ext}`;
  const storageRef = ref(storage, path);
  const buf = new Uint8Array(bytes).buffer as ArrayBuffer;
  await uploadBytes(storageRef, buf, { contentType });
  const url = await getDownloadURL(storageRef);
  return { path, url };
}

export async function uploadOcclusionImage(
  uid: string,
  deckId: string,
  file: File
): Promise<{ path: string; url: string }> {
  const ext = file.name.split(".").pop() || "png";
  const path = `users/${uid}/decks/${deckId}/occlusions/${crypto.randomUUID()}.${ext}`;
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
  }
) {
  const ref = await addDoc(occlusionsCol(uid, deckId), {
    ...sheet,
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
  patch: Partial<{ title: string; shapes: OcclusionShape[] }>
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
  imagePath: string
) {
  await deleteDoc(doc(db, "users", uid, "decks", deckId, "occlusions", sheetId));
  try {
    await deleteObject(ref(storage, imagePath));
  } catch {
    /* already gone */
  }
}
