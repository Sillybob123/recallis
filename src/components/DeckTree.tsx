import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  ChevronDown,
  Download,
  MoreVertical,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  getCardsOnce,
  getOcclusionsOnce,
  trashDeck,
  TRASH_RETENTION_DAYS,
  updateDeck,
} from "../lib/firestore";
import { exportDeckToAnki, downloadBlob } from "../lib/ankiExport";
import type { DeckCounts } from "../lib/deckCounts";
import { collectDecks, normalizeDeckPath, type DeckNode } from "../lib/deckPath";
import type { Deck } from "../types";

/** One tree row plus its descendants. */
export function DeckRows({
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const deck = node.deck;

  // The deck list clips its children, so the menu lives on <body> and is
  // positioned against the button, flipping upward near the bottom edge.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const MENU_W = 176;
    const MENU_H = 210;
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
            className="fixed z-50 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
            style={{ top: pos.top, left: pos.left }}
          >
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

