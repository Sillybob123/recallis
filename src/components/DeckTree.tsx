import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useNavigate } from "react-router-dom";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  ChevronDown,
  Copy,
  Search,
  Download,
  MoreVertical,
  Pencil,
  Plus,
  Repeat,
  SlidersHorizontal,
  Trash2,
  Zap,
} from "lucide-react";
import {
  duplicateDeck,
  getCardsOnce,
  getOcclusionsOnce,
  updateDeck,
} from "../lib/firestore";
import { exportDeckToAnki, downloadBlob } from "../lib/ankiExport";
import type { DeckCounts } from "../lib/deckCounts";
import { collectDecks, normalizeDeckPath, type DeckNode } from "../lib/deckPath";
import type { Deck } from "../types";

/** One tree row plus its descendants. */
/**
 * Whether we're on a phone-sized screen. Read once and shared, so a list of
 * fifty deck rows doesn't create fifty media-query listeners.
 */
const NARROW = "(max-width: 639px)";
function useNarrowScreen(): boolean {
  return useSyncExternalStore(
    (notify: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mq = window.matchMedia(NARROW);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () =>
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia(NARROW).matches
        : false,
    () => false
  );
}

export function DeckRows({
  node,
  uid,
  counts,
  collapsed,
  onToggle,
  onOptions,
  onAddChild,
  onDelete,
  decks,
}: {
  node: DeckNode;
  uid: string;
  counts?: Map<string, DeckCounts>;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onOptions: () => void;
  onAddChild: (parentPath: string) => void;
  onDelete: (node: DeckNode) => void;
  decks: Deck[];
}) {
  const isOpen = !collapsed.has(node.path);
  const descendants = collectDecks(node);
  const studyIds = descendants.map((d) => d.id).join(",");

  // A parent shows the sum beneath it, capped by the daily limits (Anki does
  // the same: 71 new under Anatomy still displays as 60).
  let totals: { newCount: number; learnCount: number; dueCount: number } | null =
    null;
  if (counts) {
    let newRaw = 0;
    let learn = 0;
    let dueRaw = 0;
    let newAllowance = Infinity;
    let reviewAllowance = Infinity;
    let any = false;
    for (const deck of descendants) {
      const c = counts.get(deck.id);
      if (!c) continue;
      any = true;
      newRaw += c.newRaw;
      learn += c.learnCount;
      dueRaw += c.dueRaw;
      // The budget is shared, so take it once rather than per deck.
      newAllowance = Math.min(newAllowance, c.newAllowance);
      reviewAllowance = Math.min(reviewAllowance, c.reviewAllowance);
    }
    if (any) {
      totals = {
        newCount: Math.min(newRaw, newAllowance),
        learnCount: learn,
        dueCount: Math.min(dueRaw, reviewAllowance),
      };
    }
  }

  const hasWork =
    !totals || totals.newCount + totals.learnCount + totals.dueCount > 0;

  // Nesting runs deep in an imported collection — "M1::Foundations::Anatomy::
  // Exam 1::Week 1" is five levels. Twenty pixels a level spends a third of a
  // phone's width on indentation alone, so it halves on a narrow screen.
  const indentPerLevel = useNarrowScreen() ? 10 : 20;

  return (
    <>
      {/* Sized to fit a phone without a sideways scroll: tighter gaps, a
          narrower indent per level, and count columns that give up their
          padding before the deck name gives up its characters. */}
      <li className="group flex items-center gap-1.5 border-b border-slate-100 px-2 py-2 transition last:border-b-0 hover:bg-slate-50 sm:gap-3 sm:px-4 sm:py-2.5">
        <div
          className="flex min-w-0 flex-1 items-center gap-1 sm:gap-1.5"
          style={{ paddingLeft: `${node.depth * indentPerLevel}px` }}
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
            <span className="w-3 shrink-0 sm:w-[22px]" />
          )}
          {node.deck ? (
            <Link
              to={`/deck/${node.deck.id}`}
              className="min-w-0 truncate text-[13px] font-medium text-slate-800 hover:text-indigo-600 sm:text-sm"
            >
              {node.name}
            </Link>
          ) : (
            <span
              className="min-w-0 truncate text-[13px] font-medium text-slate-800 sm:text-sm"
              title="No cards of its own — just groups the decks beneath it"
            >
              {node.name}
            </span>
          )}
          {node.children.length > 0 && (
            <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">
              {descendants.length} deck{descendants.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {counts && (
          <>
            <span className="w-6 text-right text-[11px] font-bold text-sky-500 sm:w-9 sm:text-xs">
              {totals?.newCount ?? "–"}
            </span>
            <span className="w-6 text-right text-[11px] font-bold text-orange-500 sm:w-9 sm:text-xs">
              {totals?.learnCount ?? "–"}
            </span>
            <span className="w-6 text-right text-[11px] font-bold text-emerald-600 sm:w-9 sm:text-xs">
              {totals?.dueCount ?? "–"}
            </span>
          </>
        )}

        <div className="w-14 text-right sm:w-[5.5rem]">
          {studyIds && hasWork && (
            <Link
              to={
                descendants.length === 1 && node.deck
                  ? `/deck/${node.deck.id}/study`
                  : `/study-group?ids=${studyIds}&name=${encodeURIComponent(node.path)}`
              }
              className="inline-block rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-700 sm:px-3 sm:text-xs"
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
          onDelete={onDelete}
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
            onDelete={onDelete}
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
  onDelete,
}: {
  node: DeckNode;
  uid: string;
  decks: Deck[];
  onOptions: () => void;
  onAddChild: (parentPath: string) => void;
  onDelete: (node: DeckNode) => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const deck = node.deck;
  const descendants = collectDecks(node);
  const hiddenInAnki =
    descendants.length > 0 && descendants.every((d) => d.hiddenInAnki);
  const hiddenInQuizlet =
    descendants.length > 0 && descendants.every((d) => d.hiddenInQuizlet);

  // The deck list clips its children, so the menu lives on <body> and is
  // positioned against the button, flipping upward near the bottom edge.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const MENU_W = 176;
    const MENU_H = 340;
    const below = window.innerHeight - rect.bottom;
    setPos({
      top: below < MENU_H ? rect.top - Math.min(MENU_H, rect.top - 8) : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.right - MENU_W, window.innerWidth - MENU_W - 8)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

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
    onDelete(node);
  }

  async function handleDuplicate() {
    setOpen(false);
    if (!deck) return;
    const name = prompt(
      "Name for the copy — use :: to place it under another deck",
      `${normalizeDeckPath(deck.name)} copy`
    );
    if (!name || !name.trim()) return;
    setBusy(true);
    try {
      await duplicateDeck(uid, deck.id, normalizeDeckPath(name), deck.color);
    } catch (err) {
      alert("Couldn't duplicate that deck: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleVisibility(mode: "anki" | "quizlet") {
    setOpen(false);
    const all = collectDecks(node);
    const key = mode === "anki" ? "hiddenInAnki" : "hiddenInQuizlet";
    const hiding = !all.every((d) => d[key]);
    for (const d of all) await updateDeck(uid, d.id, { [key]: hiding });
  }

  return (
    <div className="relative w-5 shrink-0 sm:w-7">
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-1 text-slate-300 transition hover:bg-slate-200 hover:text-slate-600 group-hover:text-slate-400"
        title="Deck menu"
      >
        <MoreVertical size={16} />
      </button>
      {open &&
        pos &&
        createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed z-50 max-h-[70vh] w-44 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
            style={{ top: pos.top, left: pos.left }}
          >
            <MenuItem
              icon={<Search size={14} />}
              onClick={() => {
                setOpen(false);
                navigate(
                  `/browse?deck=${descendants.map((d) => d.id).join(",")}`
                );
              }}
            >
              Browse
            </MenuItem>
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
              <MenuItem icon={<Copy size={14} />} onClick={handleDuplicate}>
                {busy ? "Working…" : "Duplicate…"}
              </MenuItem>
            )}
            <MenuItem
              icon={<Repeat size={14} />}
              onClick={() => toggleVisibility("anki")}
            >
              {hiddenInAnki ? "Add back to Anki" : "Remove from Anki"}
            </MenuItem>
            <MenuItem
              icon={<Zap size={14} />}
              onClick={() => toggleVisibility("quizlet")}
            >
              {hiddenInQuizlet ? "Add back to Quizlet" : "Remove from Quizlet"}
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
        </>,
        document.body
      )}
    </div>
  );
}

export function MenuItem({
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

