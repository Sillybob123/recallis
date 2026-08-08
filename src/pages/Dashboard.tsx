import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArchiveRestore,
  BookOpen,
  ChevronDown,
  DatabaseBackup,
  Download,
  FileUp,
  FolderPlus,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useStudyMode } from "../contexts/StudyModeContext";
import { Layout } from "../components/Layout";
import { ImportAnkiModal } from "../components/ImportAnkiModal";
import { StudySettingsModal } from "../components/StudySettingsModal";
import {
  deleteDeck,
  ensureDeckPath,
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
import { exportDeckToAnki, downloadBlob } from "../lib/ankiExport";
import { computeDeckCounts, type DeckCounts } from "../lib/deckCounts";
import { loadAnkiSettings, loadQuizletSettings } from "../lib/settings";
import {
  buildDeckTree,
  collectDecks,
  deckParentPath,
  joinDeckPath,
  normalizeDeckPath,
  splitDeckPath,
  type DeckNode,
} from "../lib/deckPath";
import type { Deck } from "../types";

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
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
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
                decks={decks}
              />
            ))}
          </ul>
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

/** One tree row plus its descendants. */
function DeckRows({
  node,
  uid,
  counts,
  collapsed,
  onToggle,
  onOptions,
  onAddChild,
  decks,
}: {
  node: DeckNode;
  uid: string;
  counts?: Map<string, DeckCounts>;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onOptions: () => void;
  onAddChild: (parentPath: string) => void;
  decks: Deck[];
}) {
  const isOpen = !collapsed.has(node.path);
  const descendants = collectDecks(node);
  const studyIds = descendants.map((d) => d.id).join(",");

  // A parent shows the sum beneath it, capped by the daily limits (Anki does
  // the same: 71 new under Anatomy still displays as 60).
  let totals: DeckCounts | null = null;
  if (counts) {
    let n = 0;
    let l = 0;
    let d = 0;
    let any = false;
    for (const deck of descendants) {
      const c = counts.get(deck.id);
      if (!c) continue;
      any = true;
      n += c.newCount;
      l += c.learnCount;
      d += c.dueCount;
    }
    if (any) {
      const limits = loadAnkiSettings();
      totals = {
        newCount: Math.min(n, limits.newPerDay),
        learnCount: l,
        dueCount: Math.min(d, limits.maxReviewsPerDay),
        dueTomorrow: 0,
      };
    }
  }

  const hasWork =
    !totals || totals.newCount + totals.learnCount + totals.dueCount > 0;

  return (
    <>
      <li className="group flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 transition last:border-b-0 hover:bg-slate-50">
        <div
          className="flex min-w-0 flex-1 items-center gap-1.5"
          style={{ paddingLeft: `${node.depth * 20}px` }}
        >
          {node.children.length > 0 ? (
            <button
              onClick={() => onToggle(node.path)}
              className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              title={isOpen ? "Collapse" : "Expand"}
            >
              <ChevronDown
                size={15}
                className={`transition-transform ${isOpen ? "" : "-rotate-90"}`}
              />
            </button>
          ) : (
            <span className="w-[22px] shrink-0" />
          )}
          {node.deck ? (
            <Link
              to={`/deck/${node.deck.id}`}
              className="min-w-0 truncate text-sm font-medium text-slate-800 hover:text-indigo-600"
            >
              {node.name}
            </Link>
          ) : (
            <span
              className="min-w-0 truncate text-sm font-medium text-slate-800"
              title="No cards of its own — just groups the decks beneath it"
            >
              {node.name}
            </span>
          )}
          {node.children.length > 0 && (
            <span className="shrink-0 text-xs text-slate-400">
              {descendants.length} deck{descendants.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {counts && (
          <>
            <span className="w-9 text-right text-xs font-bold text-sky-500">
              {totals?.newCount ?? "–"}
            </span>
            <span className="w-9 text-right text-xs font-bold text-orange-500">
              {totals?.learnCount ?? "–"}
            </span>
            <span className="w-9 text-right text-xs font-bold text-emerald-600">
              {totals?.dueCount ?? "–"}
            </span>
          </>
        )}

        <div className="w-[5.5rem] text-right">
          {studyIds && hasWork && (
            <Link
              to={
                descendants.length === 1 && node.deck
                  ? `/deck/${node.deck.id}/study`
                  : `/study-group?ids=${studyIds}&name=${encodeURIComponent(node.path)}`
              }
              className="inline-block rounded-lg bg-indigo-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-indigo-700"
              title={
                descendants.length > 1
                  ? `Study all ${descendants.length} decks under ${node.name} together`
                  : `Study ${node.name}`
              }
            >
              Study
            </Link>
          )}
        </div>

        <DeckRowMenu
          node={node}
          uid={uid}
          decks={decks}
          onOptions={onOptions}
          onAddChild={onAddChild}
        />
      </li>

      {isOpen &&
        node.children.map((child) => (
          <DeckRows
            key={child.path}
            node={child}
            uid={uid}
            counts={counts}
            collapsed={collapsed}
            onToggle={onToggle}
            onOptions={onOptions}
            onAddChild={onAddChild}
            decks={decks}
          />
        ))}
    </>
  );
}

function DeckRowMenu({
  node,
  uid,
  decks,
  onOptions,
  onAddChild,
}: {
  node: DeckNode;
  uid: string;
  decks: Deck[];
  onOptions: () => void;
  onAddChild: (parentPath: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const deck = node.deck;

  async function handleRename() {
    setOpen(false);
    if (!deck) return;
    const current = normalizeDeckPath(deck.name);
    const next = prompt(
      "Rename deck — use :: to move it, e.g. Anatomy::Lab 3",
      current
    );
    if (!next || !next.trim() || normalizeDeckPath(next) === current) return;
    const target = normalizeDeckPath(next);
    // Renaming a parent should carry its children along.
    const descendants = decks.filter((d) =>
      normalizeDeckPath(d.name).startsWith(current + "::")
    );
    await updateDeck(uid, deck.id, { name: target });
    for (const child of descendants) {
      const rest = normalizeDeckPath(child.name).slice(current.length);
      await updateDeck(uid, child.id, { name: target + rest });
    }
  }

  async function handleExport() {
    setOpen(false);
    if (!deck) return;
    setBusy(true);
    try {
      const [cards, sheets] = await Promise.all([
        getCardsOnce(uid, deck.id),
        getOcclusionsOnce(uid, deck.id),
      ]);
      const { blob, filename, warnings } = await exportDeckToAnki(
        normalizeDeckPath(deck.name),
        cards,
        sheets
      );
      downloadBlob(blob, filename);
      if (warnings.length) alert(warnings.join("\n\n"));
    } catch (err) {
      alert("Export failed: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setOpen(false);
    const all = collectDecks(node);
    if (
      confirm(
        `Move ${all.length === 1 ? `"${node.name}"` : `"${node.name}" and its ${all.length - 1} subdeck(s)`} to the trash?\n\nThey stay recoverable for ${TRASH_RETENTION_DAYS} days, then are permanently deleted.`
      )
    ) {
      for (const d of all) await trashDeck(uid, d.id);
    }
  }

  return (
    <div className="relative w-7">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-1 text-slate-300 transition hover:bg-slate-200 hover:text-slate-600 group-hover:text-slate-400"
        title="Deck menu"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            <MenuItem
              icon={<Plus size={14} />}
              onClick={() => {
                setOpen(false);
                onAddChild(node.path);
              }}
            >
              Add subdeck
            </MenuItem>
            {deck && (
              <MenuItem icon={<Pencil size={14} />} onClick={handleRename}>
                Rename
              </MenuItem>
            )}
            <MenuItem
              icon={<SlidersHorizontal size={14} />}
              onClick={() => {
                setOpen(false);
                onOptions();
              }}
            >
              Options
            </MenuItem>
            {deck && (
              <MenuItem icon={<Download size={14} />} onClick={handleExport}>
                {busy ? "Exporting…" : "Export"}
              </MenuItem>
            )}
            <MenuItem icon={<Trash2 size={14} />} danger onClick={handleDelete}>
              Delete
            </MenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  danger,
  disabled,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition disabled:opacity-40 ${
        danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      {icon}
      {children}
    </button>
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
    if (!confirm(`Permanently delete "${deck.name}" right now? This cannot be undone.`)) {
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
                      {normalizeDeckPath(deck.name)}
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
