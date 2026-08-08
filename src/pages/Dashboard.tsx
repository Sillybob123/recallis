import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  X,
  BookOpen,
  Trash2,
  FileUp,
  DatabaseBackup,
  ArchiveRestore,
  ChevronDown,
  MoreVertical,
  Pencil,
  SlidersHorizontal,
  Download,
  Undo2,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useStudyMode } from "../contexts/StudyModeContext";
import { Layout } from "../components/Layout";
import { ImportAnkiModal } from "../components/ImportAnkiModal";
import {
  createDeck,
  deleteDeck,
  getCardsOnce,
  getOcclusionsOnce,
  purgeExpiredTrash,
  restoreDeckFromTrash,
  trashDeck,
  TRASH_RETENTION_DAYS,
  updateDeck,
  watchDecks,
  watchTrashedDecks,
} from "../lib/firestore";
import { createFullBackup, restoreFullBackup } from "../lib/backup";
import { exportDeckToAnki } from "../lib/ankiExport";
import { StudySettingsModal } from "../components/StudySettingsModal";
import { loadAnkiSettings, loadQuizletSettings } from "../lib/settings";
import { computeDeckCounts, type DeckCounts } from "../lib/deckCounts";
import { downloadBlob } from "../lib/ankiExport";
import type { Deck } from "../types";

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#ec4899"];

export function Dashboard() {
  const { user } = useAuth();
  const { studyMode } = useStudyMode();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [counts, setCounts] = useState<Map<string, DeckCounts>>(new Map());
  const [trashed, setTrashed] = useState<Deck[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!user) return;
    const u1 = watchDecks(user.uid, (d) => {
      setDecks(d);
      setLoading(false);
    });
    const u2 = watchTrashedDecks(user.uid, setTrashed);
    // Hard-delete anything that's been in the trash past the retention window.
    purgeExpiredTrash(user.uid).catch(() => {});
    return () => {
      u1();
      u2();
    };
  }, [user]);

  // Anki-mode "New / Learn / Due" columns, computed per deck.
  useEffect(() => {
    if (!user || studyMode !== "anki" || decks.length === 0) return;
    let cancelled = false;
    (async () => {
      const next = new Map<string, DeckCounts>();
      for (const deck of decks) {
        try {
          next.set(deck.id, await computeDeckCounts(user.uid, deck.id));
        } catch {
          /* deck may have been deleted mid-fetch */
        }
        if (cancelled) return;
        setCounts(new Map(next));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, studyMode, decks.length]);

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Your classes</h1>
          <p className="text-sm text-slate-500">
            Flashcards, cloze cards, and image occlusion — all in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <FileUp size={15} />
            Import Anki file
          </button>
          <button
            onClick={handleBackup}
            disabled={backingUp || decks.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            title="Download a zip of every deck, card, and image"
          >
            <DatabaseBackup size={15} />
            {backingUp ? "Backing up…" : "Back up"}
          </button>
          <button
            onClick={() => restoreInputRef.current?.click()}
            disabled={restoring}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            title="Restore decks from a backup zip (creates new decks; never overwrites)"
          >
            <ArchiveRestore size={15} />
            {restoring ? "Restoring…" : "Restore"}
          </button>
          <input
            ref={restoreInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleRestoreFile(e.target.files[0])}
          />
          <button
            onClick={() => setShowTrash(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            title="Deleted decks are kept here for 30 days"
          >
            <Trash2 size={15} />
            Trash{trashed.length > 0 ? ` (${trashed.length})` : ""}
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            <Plus size={16} />
            New deck
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-24 text-center text-slate-400">Loading your decks…</div>
      ) : decks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center">
          <BookOpen className="mx-auto mb-3 text-slate-300" size={40} />
          <p className="mb-1 font-medium text-slate-700">No decks yet</p>
          <p className="mb-4 text-sm text-slate-500">
            Create your first deck for a class, e.g. "Anatomy Lab 1".
          </p>
          <button
            onClick={() => setShowNew(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Create a deck
          </button>
        </div>
      ) : (
        <>
          <DeckSections
            decks={decks}
            uid={user!.uid}
            counts={studyMode === "anki" ? counts : undefined}
            onOptions={() => setShowOptions(true)}
          />
        </>
      )}

      {showNew && (
        <NewDeckModal uid={user!.uid} onClose={() => setShowNew(false)} />
      )}
      {showImport && (
        <ImportAnkiModal uid={user!.uid} onClose={() => setShowImport(false)} />
      )}
      {showTrash && (
        <TrashModal uid={user!.uid} trashed={trashed} onClose={() => setShowTrash(false)} />
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

/**
 * Groups decks by top-level name ("Anatomy · Lab00 · Positions" → class
 * "Anatomy") into collapsible sections, and inside each class groups the
 * subdecks ("Lab00", "Breast and Thorax") so the Anki hierarchy reads as a
 * tree: class ▸ subdeck ▸ topic. Standalone decks appear first, ungrouped.
 */
function DeckSections({ decks, uid, counts, onOptions }: { decks: Deck[]; uid: string; counts?: Map<string, DeckCounts>; onOptions: () => void }) {
  const standalone: Deck[] = [];
  const classes = new Map<string, Deck[]>();
  for (const deck of decks) {
    const sep = deck.name.indexOf(" · ");
    if (sep === -1) {
      standalone.push(deck);
    } else {
      const top = deck.name.slice(0, sep);
      const list = classes.get(top) ?? [];
      list.push(deck);
      classes.set(top, list);
    }
  }
  for (const list of classes.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <div className="space-y-6">
      {standalone.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {standalone.map((deck) => (
            <DeckCard key={deck.id} deck={deck} uid={uid} counts={counts?.get(deck.id)} onOptions={onOptions} />
          ))}
        </div>
      )}
      {Array.from(classes.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([top, list]) => (
          <ClassSection key={top} top={top} list={list} uid={uid} counts={counts} onOptions={onOptions} />
        ))}
    </div>
  );
}

function ClassSection({ top, list, uid, counts, onOptions }: { top: string; list: Deck[]; uid: string; counts?: Map<string, DeckCounts>; onOptions: () => void }) {
  const [open, setOpen] = useState(() => localStorage.getItem(`deckSection:${top}`) !== "closed");

  function toggle() {
    setOpen((o) => {
      localStorage.setItem(`deckSection:${top}`, o ? "closed" : "open");
      return !o;
    });
  }

  // Second-level grouping: "Lab00 · Positions" clusters under "Lab00".
  const subGroups = new Map<string, Deck[]>();
  for (const deck of list) {
    const rest = deck.name.slice(top.length + 3);
    const sep = rest.indexOf(" · ");
    const sub = sep === -1 ? "" : rest.slice(0, sep);
    const arr = subGroups.get(sub) ?? [];
    arr.push(deck);
    subGroups.set(sub, arr);
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex w-full items-center gap-2 px-5 py-4">
        <button onClick={toggle} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown
            size={18}
            className={`shrink-0 text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <span className="truncate text-base font-bold text-slate-900">{top}</span>
          <span className="text-xs text-slate-400">
            {list.length} deck{list.length === 1 ? "" : "s"}
          </span>
        </button>
        <GroupCounts decks={list} counts={counts} />
        <GroupStudyLink name={top} decks={list} />
      </div>
      {open && (
        <div className="space-y-5 border-t border-slate-100 p-5">
          {Array.from(subGroups.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([sub, subDecks]) => (
              <div key={sub || "__root"}>
                {sub && (
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                      {sub}
                    </h3>
                    <GroupCounts decks={subDecks} counts={counts} />
                    <GroupStudyLink name={`${top} · ${sub}`} decks={subDecks} small />
                  </div>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {subDecks.map((deck) => {
                    const rest = deck.name.slice(top.length + 3);
                    const display = sub ? rest.slice(sub.length + 3) || sub : rest;
                    return (
                      <DeckCard
                        key={deck.id}
                        deck={deck}
                        uid={uid}
                        displayName={display}
                        counts={counts?.get(deck.id)}
                        onOptions={onOptions}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

function DeckCard({
  deck,
  uid,
  displayName,
  counts,
  onOptions,
}: {
  deck: Deck;
  uid: string;
  displayName?: string;
  counts?: DeckCounts;
  onOptions: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  function stop(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  async function handleRename(e: React.MouseEvent) {
    stop(e);
    setMenuOpen(false);
    const name = prompt("Rename deck:", deck.name);
    if (name && name.trim() && name.trim() !== deck.name) {
      await updateDeck(uid, deck.id, { name: name.trim() });
    }
  }

  async function handleExport(e: React.MouseEvent) {
    stop(e);
    setMenuOpen(false);
    setExporting(true);
    try {
      const [cards, sheets] = await Promise.all([
        getCardsOnce(uid, deck.id),
        getOcclusionsOnce(uid, deck.id),
      ]);
      const { blob, filename, warnings } = await exportDeckToAnki(
        deck.name,
        cards,
        sheets
      );
      downloadBlob(blob, filename);
      if (warnings.length) alert(warnings.join("\n\n"));
    } catch (err) {
      alert("Export failed: " + (err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    stop(e);
    setMenuOpen(false);
    if (
      confirm(
        `Move "${deck.name}" to the trash?\n\nIt will sit there for ${TRASH_RETENTION_DAYS} days (restorable any time from the Trash button) and then be permanently deleted, freeing its storage.`
      )
    ) {
      await trashDeck(uid, deck.id);
    }
  }

  return (
    <Link
      to={`/deck/${deck.id}`}
      className="group relative overflow-visible rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div
        className="absolute inset-x-0 top-0 h-1.5 rounded-t-2xl"
        style={{ backgroundColor: deck.color }}
      />
      <div className="mb-3 flex items-start justify-between">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: deck.color }}
        >
          <BookOpen size={18} />
        </span>
        <div className="relative">
          <button
            onClick={(e) => {
              stop(e);
              setMenuOpen((o) => !o);
            }}
            className="rounded-md p-1.5 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600 group-hover:text-slate-400"
            title="Deck menu"
          >
            <MoreVertical size={16} />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 top-8 z-20 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
              onClick={stop}
            >
              <MenuItem icon={<Pencil size={14} />} onClick={handleRename}>
                Rename
              </MenuItem>
              <MenuItem
                icon={<SlidersHorizontal size={14} />}
                onClick={(e) => {
                  stop(e);
                  setMenuOpen(false);
                  onOptions();
                }}
              >
                Options
              </MenuItem>
              <MenuItem icon={<Download size={14} />} onClick={handleExport}>
                {exporting ? "Exporting…" : "Export"}
              </MenuItem>
              <MenuItem icon={<Trash2 size={14} />} danger onClick={handleDelete}>
                Delete
              </MenuItem>
            </div>
          )}
        </div>
      </div>
      <h3 className="mb-1 font-bold text-slate-900">{displayName ?? deck.name}</h3>
      {deck.subject && <p className="text-sm text-slate-500">{deck.subject}</p>}
      {counts && (
        <div className="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-50 px-2 py-1.5 text-center">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">New</p>
            <p className="text-sm font-bold text-sky-500">{counts.newCount}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Learn</p>
            <p className="text-sm font-bold text-orange-500">{counts.learnCount}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Due</p>
            <p className="text-sm font-bold text-emerald-600">{counts.dueCount}</p>
          </div>
        </div>
      )}
    </Link>
  );
}

function NewDeckModal({ uid, onClose }: { uid: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    await createDeck(uid, name.trim(), subject.trim(), color);
    setBusy(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">New deck</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            autoFocus
            placeholder="Deck name, e.g. Anatomy Lab 1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          <input
            placeholder="Subject (optional), e.g. Anatomy"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                className="h-7 w-7 rounded-full ring-offset-2"
                style={{
                  backgroundColor: c,
                  boxShadow: color === c ? `0 0 0 2px ${c}` : undefined,
                }}
              />
            ))}
          </div>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create deck"}
          </button>
        </form>
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  danger,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  danger?: boolean;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
        danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      {icon}
      {children}
    </button>
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
  const [busy, setBusy] = useState(false);

  function daysLeft(deletedAt: number): number {
    const expiry = deletedAt + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    return Math.max(0, Math.ceil((expiry - Date.now()) / (24 * 60 * 60 * 1000)));
  }

  async function emptyTrash() {
    if (
      !confirm(
        `Permanently delete ${trashed.length} deck${trashed.length === 1 ? "" : "s"} and all their cards, images, and schedules? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await purgeExpiredTrash(uid, true);
    } finally {
      setBusy(false);
    }
  }

  async function deleteForever(deck: Deck) {
    if (
      !confirm(
        `Permanently delete "${deck.name}" right now? This cannot be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await deleteDeck(uid, deck.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Trash</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Deleted decks are kept for {TRASH_RETENTION_DAYS} days, then removed
          permanently (cards, images, and schedules — freeing storage).
        </p>
        {trashed.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">Trash is empty.</p>
        ) : (
          <>
            <ul className="mb-4 space-y-2">
              {trashed.map((deck) => (
                <li
                  key={deck.id}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2"
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: deck.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {deck.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {daysLeft(deck.deletedAt!)} day
                      {daysLeft(deck.deletedAt!) === 1 ? "" : "s"} until permanent
                      deletion
                    </p>
                  </div>
                  <button
                    onClick={() => restoreDeckFromTrash(uid, deck.id)}
                    disabled={busy}
                    className="flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Undo2 size={12} /> Restore
                  </button>
                  <button
                    onClick={() => deleteForever(deck)}
                    disabled={busy}
                    className="rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Delete now
                  </button>
                </li>
              ))}
            </ul>
            <button
              onClick={emptyTrash}
              disabled={busy}
              className="w-full rounded-lg border border-red-200 bg-red-50 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-100 disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Empty trash now"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** "Study" for a whole class or subdeck group: pools every deck underneath. */
function GroupStudyLink({
  name,
  decks,
  small,
}: {
  name: string;
  decks: Deck[];
  small?: boolean;
}) {
  const ids = decks.map((d) => d.id).join(",");
  return (
    <Link
      to={`/study-group?ids=${ids}&name=${encodeURIComponent(name)}`}
      onClick={(e) => e.stopPropagation()}
      className={`shrink-0 rounded-lg bg-indigo-600 font-semibold text-white transition hover:bg-indigo-700 ${
        small ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm"
      }`}
      title={`Study all ${decks.length} decks under ${name} together (Anki-style: pooled queue, shared daily limits)`}
    >
      Study
    </Link>
  );
}

function GroupCounts({
  decks,
  counts,
}: {
  decks: Deck[];
  counts?: Map<string, DeckCounts>;
}) {
  if (!counts) return null;
  let n = 0,
    l = 0,
    d = 0;
  let any = false;
  for (const deck of decks) {
    const c = counts.get(deck.id);
    if (!c) continue;
    any = true;
    n += c.newCount;
    l += c.learnCount;
    d += c.dueCount;
  }
  if (!any) return null;
  // A parent shows at most its own daily limit, even if more exists beneath
  // (Anki: 71 new under Anatomy, but Anatomy displays 60).
  const limits = loadAnkiSettings();
  n = Math.min(n, limits.newPerDay);
  d = Math.min(d, limits.maxReviewsPerDay);
  return (
    <span className="flex shrink-0 gap-2 text-xs font-bold">
      <span className="text-sky-500">{n}</span>
      <span className="text-orange-500">{l}</span>
      <span className="text-emerald-600">{d}</span>
    </span>
  );
}
