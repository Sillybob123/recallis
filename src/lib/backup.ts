import JSZip from "jszip";
import { getDocs } from "firebase/firestore";
import { ref, getBlob } from "firebase/storage";
import { storage } from "../firebase";
import {
  cardsCol,
  createCardsBulk,
  createDeck,
  createOcclusionSheet,
  decksCol,
  occlusionsCol,
  uploadOcclusionImage,
} from "./firestore";
import type { CardData, OcclusionShape } from "../types";

export const BACKUP_VERSION = 1;

interface BackupSheet {
  id: string;
  title: string;
  imagePath: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  shapes: OcclusionShape[];
  /** filename inside the zip's images/ folder, when the bytes were downloadable */
  imageFile?: string;
}

interface BackupDeck {
  name: string;
  subject?: string;
  color: string;
  cards: { data: CardData; stats: { correct: number; incorrect: number } }[];
  occlusions: BackupSheet[];
}

interface BackupFile {
  version: number;
  exportedAt: string;
  decks: BackupDeck[];
}

export interface BackupResult {
  blob: Blob;
  filename: string;
  warnings: string[];
  deckCount: number;
  cardCount: number;
  sheetCount: number;
}

/** Downloads every deck, card, occlusion sheet, and (best-effort) image into one zip. */
export async function createFullBackup(uid: string): Promise<BackupResult> {
  const zip = new JSZip();
  const images = zip.folder("images")!;
  const warnings: string[] = [];

  const decksSnap = await getDocs(decksCol(uid));
  const decks: BackupDeck[] = [];
  let cardCount = 0;
  let sheetCount = 0;

  for (const deckDoc of decksSnap.docs) {
    const d = deckDoc.data();
    const [cardsSnap, occSnap] = await Promise.all([
      getDocs(cardsCol(uid, deckDoc.id)),
      getDocs(occlusionsCol(uid, deckDoc.id)),
    ]);

    const cards = cardsSnap.docs.map((c) => {
      const data = c.data();
      return {
        data: data.data as CardData,
        stats: data.stats ?? { correct: 0, incorrect: 0 },
      };
    });
    cardCount += cards.length;

    const occlusions: BackupSheet[] = [];
    for (const occDoc of occSnap.docs) {
      const o = occDoc.data();
      const sheet: BackupSheet = {
        id: occDoc.id,
        title: o.title ?? "Untitled",
        imagePath: o.imagePath,
        imageUrl: o.imageUrl,
        imageWidth: o.imageWidth,
        imageHeight: o.imageHeight,
        shapes: o.shapes ?? [],
      };
      try {
        const blob = await getBlob(ref(storage, sheet.imagePath));
        const ext = (sheet.imagePath.split(".").pop() || "png").toLowerCase();
        const fileName = `${occDoc.id}.${ext}`;
        images.file(fileName, blob);
        sheet.imageFile = fileName;
      } catch {
        warnings.push(
          `Image for sheet "${sheet.title}" couldn't be downloaded into the backup (Storage CORS not configured — see README). Its mask layout and cloud link are still backed up.`
        );
      }
      occlusions.push(sheet);
      sheetCount++;
    }

    decks.push({
      name: d.name,
      subject: d.subject,
      color: d.color ?? "#6366f1",
      cards,
      occlusions,
    });
  }

  const backup: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    decks,
  };
  zip.file("backup.json", JSON.stringify(backup, null, 2));

  const blob = await zip.generateAsync({ type: "blob" });
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    blob,
    filename: `recallis-backup-${stamp}.zip`,
    warnings,
    deckCount: decks.length,
    cardCount,
    sheetCount,
  };
}

/**
 * Snapshot of a single deck as JSON, auto-downloaded before destructive
 * actions (deck delete) so even an accidental confirm can be undone by
 * restoring from the downloaded file via "Restore backup".
 */
export async function createDeckSnapshot(
  uid: string,
  deckId: string,
  deckMeta: { name: string; subject?: string; color: string }
): Promise<{ blob: Blob; filename: string }> {
  const [cardsSnap, occSnap] = await Promise.all([
    getDocs(cardsCol(uid, deckId)),
    getDocs(occlusionsCol(uid, deckId)),
  ]);

  const zip = new JSZip();
  const images = zip.folder("images")!;

  const occlusions: BackupSheet[] = [];
  for (const occDoc of occSnap.docs) {
    const o = occDoc.data();
    const sheet: BackupSheet = {
      id: occDoc.id,
      title: o.title ?? "Untitled",
      imagePath: o.imagePath,
      imageUrl: o.imageUrl,
      imageWidth: o.imageWidth,
      imageHeight: o.imageHeight,
      shapes: o.shapes ?? [],
    };
    try {
      const blob = await getBlob(ref(storage, sheet.imagePath));
      const ext = (sheet.imagePath.split(".").pop() || "png").toLowerCase();
      const fileName = `${occDoc.id}.${ext}`;
      images.file(fileName, blob);
      sheet.imageFile = fileName;
    } catch {
      /* CORS not configured — metadata still saved */
    }
    occlusions.push(sheet);
  }

  const backup: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    decks: [
      {
        name: deckMeta.name,
        subject: deckMeta.subject,
        color: deckMeta.color,
        cards: cardsSnap.docs.map((c) => {
          const data = c.data();
          return {
            data: data.data as CardData,
            stats: data.stats ?? { correct: 0, incorrect: 0 },
          };
        }),
        occlusions,
      },
    ],
  };
  zip.file("backup.json", JSON.stringify(backup, null, 2));

  const blob = await zip.generateAsync({ type: "blob" });
  const safe = deckMeta.name.replace(/[^a-z0-9 _-]/gi, "").trim() || "deck";
  return { blob, filename: `${safe}-before-delete.zip` };
}

export interface RestoreResult {
  decksCreated: number;
  cardsCreated: number;
  sheetsCreated: number;
  warnings: string[];
}

/**
 * Restores a backup zip. Always creates NEW decks (suffixed "(restored)"),
 * never overwrites or deletes anything that already exists — restoring twice
 * simply gives you duplicates you can delete, which is the safe direction.
 */
export async function restoreFullBackup(
  uid: string,
  file: File
): Promise<RestoreResult> {
  const zip = await JSZip.loadAsync(file);
  const jsonFile = zip.file("backup.json");
  if (!jsonFile) {
    throw new Error("Not a Recallis backup: backup.json missing from zip.");
  }
  const backup = JSON.parse(await jsonFile.async("string")) as BackupFile;
  if (!backup.decks || !Array.isArray(backup.decks)) {
    throw new Error("Backup file is malformed (no decks array).");
  }

  const warnings: string[] = [];
  let decksCreated = 0;
  let cardsCreated = 0;
  let sheetsCreated = 0;

  for (const deck of backup.decks) {
    const deckId = await createDeck(
      uid,
      `${deck.name} (restored)`,
      deck.subject ?? "",
      deck.color
    );
    decksCreated++;

    if (deck.cards.length) {
      await createCardsBulk(
        uid,
        deckId,
        deck.cards.map((c) => c.data)
      );
      cardsCreated += deck.cards.length;
    }

    for (const sheet of deck.occlusions) {
      try {
        let imagePath = sheet.imagePath;
        let imageUrl = sheet.imageUrl;

        const zipImage = sheet.imageFile
          ? zip.file(`images/${sheet.imageFile}`)
          : null;
        if (zipImage) {
          const blob = await zipImage.async("blob");
          const ext = sheet.imageFile!.split(".").pop() || "png";
          const asFile = new File([blob], `restored.${ext}`, {
            type: ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`,
          });
          const uploaded = await uploadOcclusionImage(uid, deckId, asFile);
          imagePath = uploaded.path;
          imageUrl = uploaded.url;
        } else {
          warnings.push(
            `Sheet "${sheet.title}": no image bytes in backup, so it still points at the original cloud image. If that original was deleted, re-upload the image.`
          );
        }

        await createOcclusionSheet(uid, deckId, {
          title: sheet.title,
          imagePath,
          imageUrl,
          imageWidth: sheet.imageWidth,
          imageHeight: sheet.imageHeight,
          shapes: sheet.shapes,
        });
        sheetsCreated++;
      } catch (err) {
        warnings.push(
          `Sheet "${sheet.title}" failed to restore: ${(err as Error).message}`
        );
      }
    }
  }

  return { decksCreated, cardsCreated, sheetsCreated, warnings };
}
