import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArchiveRestore,
  BookOpen,
  DatabaseBackup,
  FileUp,
  FolderPlus,
  MoreHorizontal,
  Plus,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useStudyMode } from "../contexts/StudyModeContext";
import { Layout } from "../components/Layout";
import { ImportAnkiModal } from "../components/ImportAnkiModal";
import { StudySettingsModal } from "../components/StudySettingsModal";
import { DeleteDeckModal } from "../components/DeleteDeckModal";
import {
  deleteDeck,
  ensureDeckPath,
  purgeExpiredTrash,
  restoreDeckFromTrash,
  TRASH_RETENTION_DAYS,
  watchDecks,
  watchTrashedDecks,
} from "../lib/firestore";
import { createFullBackup, restoreFullBackup } from "../lib/backup";
import { downloadBlob } from "../lib/ankiExport";
import { computeAllDeckCounts, type DeckCounts } from "../lib/deckCounts";
import { loadAnkiSettings, loadQuizletSettings } from "../lib/settings";
import {
  buildDeckTree,
  deckParentPath,
  joinDeckPath,
  normalizeDeckPath,
  splitDeckPath,
  type DeckNode,
} from "../lib/deckPath";
import { DeckRows, MenuItem } from "../components/DeckTree";
import type { Deck } from "../types";
import { DeckLabel } from "../components/DeckLabel";

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#ec4899"];

export function Dashboard() {
  const { user } = useAuth();
  const { studyMode } = useStudyMode();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [counts, setCounts] = useState<Map<string, DeckCounts>>(new Map());
  const [trashed, setTrashed] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDeck, setNewDeck] = useState<null | { parent: string; isClass: boolean }>(null);
  const [showImport, setShowImport] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [deleting, setDeleting] = useState<DeckNode | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("collapsedDecks") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const restoreInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    const u1 = watchDecks(user.uid, (d) => {
      setDecks(d);
      setLoading(false);
    });
    const u2 = watchTrashedDecks(user.uid, setTrashed);
    purgeExpiredTrash(user.uid).catch(() => {});
    return () => {
      u1();
      u2();
    };
  }, [user]);

  // Per-deck New/Learn/Due, filled in progressively.
  useEffect(() => {
    if (!user || studyMode !== "anki" || decks.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await computeAllDeckCounts(
          user.uid,
          decks.map((d) => d.id)
        );
        if (!cancelled) setCounts(next);
      } catch {
        /* decks may have changed underneath us */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, studyMode, decks]);

  const tree = useMemo(() => buildDeckTree(decks), [decks]);

  function toggleCollapse(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      localStorage.setItem("collapsedDecks", JSON.stringify([...next]));
      return next;
    });
  }

  async function handleBackup() {
    if (!user) return;
    setBackingUp(true);
    try {
      const res = await createFullBackup(user.uid);
      downloadBlob(res.blob, res.filename);
      const msg = `Backed up ${res.deckCount} decks, ${res.cardCount} cards, ${res.sheetCount} image sheets.`;
      alert(res.warnings.length ? `${msg}\n\n${res.warnings.join("\n")}` : msg);
    } catch (err) {
      alert("Backup failed: " + (err as Error).message);
    } finally {
      setBackingUp(false);
    }
  }

  async function handleRestoreFile(file: File) {
    if (!user) return;
    setRestoring(true);
    try {
      const res = await restoreFullBackup(user.uid, file);
      const msg = `Restored ${res.decksCreated} decks with ${res.cardsCreated} cards and ${res.sheetsCreated} image sheets (as new "(restored)" decks — nothing existing was touched).`;
      alert(res.warnings.length ? `${msg}\n\n${res.warnings.join("\n")}` : msg);
    } catch (err) {
      alert("Restore failed: " + (err as Error).message);
    } finally {
      setRestoring(false);
      if (restoreInputRef.current) restoreInputRef.current.value = "";
    }
  }

  return (
    <Layout>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Your classes</h1>
          <p className="text-sm text-slate-500">
            Flashcards, cloze cards, and image occlusion — all in one place.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setNewDeck({ parent: "", isClass: true })}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <FolderPlus size={15} /> New class
          </button>
          <button
            onClick={() => setNewDeck({ parent: "", isClass: false })}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            <Plus size={16} /> New deck
          </button>
          <div className="relative">
            <button
              onClick={() => setMoreOpen((o) => !o)}
              className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <MoreHorizontal size={15} /> More
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />
                <div
                  className="absolute right-0 top-11 z-20 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
                  onClick={() => setMoreOpen(false)}
                >
                  <MenuItem icon={<FileUp size={14} />} onClick={() => setShowImport(true)}>
                    Import Anki file
                  </MenuItem>
                  <MenuItem
                    icon={<DatabaseBackup size={14} />}
                    onClick={handleBackup}
                    disabled={backingUp || decks.length === 0}
                  >
                    {backingUp ? "Backing up…" : "Back up everything"}
                  </MenuItem>
                  <MenuItem
                    icon={<ArchiveRestore size={14} />}
                    onClick={() => restoreInputRef.current?.click()}
                    disabled={restoring}
                  >
                    {restoring ? "Restoring…" : "Restore from backup"}
                  </MenuItem>
                  <div className="my-1 border-t border-slate-100" />
                  <MenuItem icon={<Trash2 size={14} />} onClick={() => setShowTrash(true)}>
                    Trash{trashed.length > 0 ? ` (${trashed.length})` : ""}
                  </MenuItem>
                </div>
              </>
            )}
          </div>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleRestoreFile(e.target.files[0])}
          />
        </div>
      </div>

      {loading ? (
        <div className="py-24 text-center text-slate-400">Loading your decks…</div>
      ) : decks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center">
          <BookOpen className="mx-auto mb-3 text-slate-300" size={40} />
          <p className="mb-1 font-medium text-slate-700">No decks yet</p>
          <p className="mb-4 text-sm text-slate-500">
            Start with a class like “Anatomy”, then add decks inside it.
          </p>
          <button
            onClick={() => setNewDeck({ parent: "", isClass: true })}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Create a class
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="min-w-[560px]">
          <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <span className="flex-1">Deck</span>
            {studyMode === "anki" && (
              <>
                <span className="w-9 text-right text-sky-500">New</span>
                <span className="w-9 text-right text-orange-500">Learn</span>
                <span className="w-9 text-right text-emerald-600">Due</span>
              </>
            )}
            <span className="w-[5.5rem]" />
            <span className="w-7" />
          </div>
          <ul>
            {tree.map((node) => (
              <DeckRows
                key={node.path}
                node={node}
                uid={user!.uid}
                counts={studyMode === "anki" ? counts : undefined}
                collapsed={collapsed}
                onToggle={toggleCollapse}
                onOptions={() => setShowOptions(true)}
                onAddChild={(parent) => setNewDeck({ parent, isClass: false })}
                onDelete={setDeleting}
                decks={decks}
              />
            ))}
          </ul>
          </div>
        </div>
      )}

      {newDeck && (
        <NewDeckModal
          uid={user!.uid}
          decks={decks}
          initialParent={newDeck.parent}
          isClass={newDeck.isClass}
          onClose={() => setNewDeck(null)}
        />
      )}
      {showImport && (
        <ImportAnkiModal uid={user!.uid} onClose={() => setShowImport(false)} />
      )}
      {showTrash && (
        <TrashModal uid={user!.uid} trashed={trashed} onClose={() => setShowTrash(false)} />
      )}
      {deleting && (
        <DeleteDeckModal
          uid={user!.uid}
          node={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
      {showOptions && (
        <StudySettingsModal
          studyMode={studyMode}
          anki={loadAnkiSettings()}
          quizlet={loadQuizletSettings()}
          onChange={() => {}}
          onClose={() => setShowOptions(false)}
        />
      )}
    </Layout>
  );
}

function NewDeckModal({
  uid,
  decks,
  initialParent,
  isClass,
  onClose,
}: {
  uid: string;
  decks: Deck[];
  initialParent: string;
  isClass: boolean;
  onClose: () => void;
}) {
  const [parent, setParent] = useState(initialParent);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[Math.floor(Math.random() * COLORS.length)]);
  const [busy, setBusy] = useState(false);

  const parents = useMemo(() => {
    const set = new Set<string>();
    for (const d of decks) {
      const path = normalizeDeckPath(d.name);
      set.add(path);
      const p = deckParentPath(path);
      if (p) set.add(p);
    }
    return [...set].sort();
  }, [decks]);

  const fullPath = joinDeckPath([
    ...splitDeckPath(isClass ? "" : parent),
    ...splitDeckPath(name),
  ]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!fullPath) return;
    setBusy(true);
    try {
      await ensureDeckPath(uid, fullPath, decks, color);
      onClose();
    } catch (err) {
      alert("Couldn't create that deck: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">
            {isClass ? "New class" : "New deck"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isClass && (
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-slate-700">
                Inside{" "}
                <span className="font-normal text-slate-400">
                  — leave blank for a top-level deck
                </span>
              </span>
              <input
                value={parent}
                onChange={(e) => setParent(e.target.value)}
                list="parent-decks"
                placeholder="e.g. Anatomy"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
              />
              <datalist id="parent-decks">
                {parents.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </label>
          )}

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-slate-700">
              {isClass ? "Class name" : "Deck name"}
              {!isClass && (
                <span className="font-normal text-slate-400">
                  {" "}
                  — use :: to nest deeper
                </span>
              )}
            </span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isClass ? "Anatomy" : "Lab 3::Breast and Thorax"}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-slate-700">
              Color
            </span>
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="h-7 w-7 rounded-full border-2 transition"
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? "#1e293b" : "transparent",
                  }}
                />
              ))}
            </div>
          </div>

          {fullPath && (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              Creates <b className="text-slate-700">{fullPath}</b>
              {splitDeckPath(fullPath).length > 1 &&
                " — any missing parent decks are created too."}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !fullPath}
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Creating…" : isClass ? "Create class" : "Create deck"}
          </button>
        </form>
      </div>
    </div>
  );
}

function TrashModal({
  uid,
  trashed,
  onClose,
}: {
  uid: string;
  trashed: Deck[];
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  function daysLeft(deletedAt: number): number {
    const expiry = deletedAt + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    return Math.max(0, Math.ceil((expiry - Date.now()) / (24 * 60 * 60 * 1000)));
  }

  async function emptyTrash() {
    if (
      !confirm(
        `Permanently delete ${trashed.length} deck${trashed.length === 1 ? "" : "s"}?\n\n` +
          `Every card, image, and schedule inside them is erased from storage. ` +
          `This frees the space they were costing you and cannot be undone.`
      )
    ) {
      return;
    }
    setBusy("all");
    try {
      await purgeExpiredTrash(uid, true);
    } catch (err) {
      alert("Couldn't empty the trash: " + (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function deleteForever(deck: Deck) {
    if (
      !confirm(
        `Permanently delete "${normalizeDeckPath(deck.name)}" and everything in it? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(deck.id);
    try {
      await deleteDeck(uid, deck.id);
    } catch (err) {
      alert("Couldn't delete that deck: " + (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const expiringSoon = trashed.filter((d) => daysLeft(d.deletedAt!) <= 3).length;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Trash</h2>
            <p className="text-xs text-slate-500">
              Deleted decks wait {TRASH_RETENTION_DAYS} days here, then their
              cards, images, and schedules are erased from storage for good.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {trashed.length === 0 ? (
            <div className="py-14 text-center">
              <Trash2 className="mx-auto mb-3 text-slate-200" size={38} />
              <p className="text-sm font-medium text-slate-600">Trash is empty</p>
              <p className="mt-1 text-xs text-slate-400">
                Nothing is taking up storage here.
              </p>
            </div>
          ) : (
            <>
              {expiringSoon > 0 && (
                <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {expiringSoon} deck{expiringSoon === 1 ? "" : "s"} will be
                  permanently deleted within 3 days. Restore anything you still
                  want.
                </p>
              )}
              <ul className="divide-y divide-slate-100">
                {trashed.map((deck) => {
                  const left = daysLeft(deck.deletedAt!);
                  return (
                    <li key={deck.id} className="flex items-center gap-3 py-2.5">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: deck.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <DeckLabel name={deck.name} className="block" />
                        <p
                          className={`text-xs ${left <= 3 ? "text-amber-600" : "text-slate-400"}`}
                        >
                          {left === 0
                            ? "Deleting today"
                            : `${left} day${left === 1 ? "" : "s"} left`}
                        </p>
                      </div>
                      <button
                        onClick={() => restoreDeckFromTrash(uid, deck.id)}
                        disabled={busy !== null}
                        className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Undo2 size={12} /> Restore
                      </button>
                      <button
                        onClick={() => deleteForever(deck)}
                        disabled={busy !== null}
                        className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                      >
                        {busy === deck.id ? "Deleting…" : "Delete now"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {trashed.length > 0 && (
          <div className="flex shrink-0 items-center gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
            <p className="mr-auto text-xs text-slate-500">
              Emptying the trash frees the storage these decks are still using.
            </p>
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            >
              Close
            </button>
            <button
              onClick={emptyTrash}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
            >
              <Trash2 size={15} />
              {busy === "all"
                ? "Deleting everything…"
                : `Delete all ${trashed.length} permanently`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
