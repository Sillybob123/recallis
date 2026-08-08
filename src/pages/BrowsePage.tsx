import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRightLeft,
  Check,
  ChevronDown,
  Flag,
  Loader2,
  Moon,
  Pause,
  Pencil,
  Play,
  Replace,
  ScanEye,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Layout } from "../components/Layout";
import { RichTextEditor } from "../components/RichTextEditor";
import {
  deleteCard,
  deleteOcclusionSheet,
  deleteSrsState,
  moveCardsToDeck,
  moveSheetsToDeck,
  setSrsState,
  updateCard,
  watchDecks,
} from "../lib/firestore";
import { loadStudyData, type StudyData } from "../lib/studyLoad";
import type { StudyItem } from "../lib/studyItems";
import { normalizeDeckPath, splitDeckPath } from "../lib/deckPath";
import {
  formatDelay,
  newSrsState,
  nextDayStart,
  type FlagColor,
  type SrsState,
} from "../lib/srs";
import { startOfStudyDay } from "../lib/settings";
import type { Deck } from "../types";

type CardState = "new" | "learning" | "review" | "suspended" | "buried";
type TodayFilter = "due" | "overdue" | "added" | "studied";
type SortCol = "preview" | "type" | "state" | "due" | "deck";

const TODAY_LABELS: Record<TodayFilter, string> = {
  due: "Due",
  overdue: "Overdue",
  added: "Added today",
  studied: "Studied today",
};

const STATE_ORDER: Record<CardState, number> = {
  new: 0,
  learning: 1,
  review: 2,
  suspended: 3,
  buried: 4,
};

/** Sortable due value: scheduled cards by date, new cards after, by position. */
function dueSortValue(row: Row): number {
  if (row.state === "new") return 8e15 + (row.newPos ?? 0);
  return row.srs?.due ?? 9e15;
}
type NoteKind = "cloze" | "basic" | "occlusion";

const STATE_LABELS: Record<CardState, string> = {
  new: "New",
  learning: "Learning",
  review: "Review",
  suspended: "Suspended",
  buried: "Buried",
};

const FLAG_COLORS: Record<FlagColor, string> = {
  red: "#ef4444",
  orange: "#f97316",
  green: "#10b981",
  blue: "#0ea5e9",
};

interface Row {
  item: StudyItem;
  key: string; // combined key
  noteId: string; // cardId or sheetId — the unit bulk note-ops act on
  deck: Deck | undefined;
  kind: NoteKind;
  typeLabel: string; // "Cloze 1", "Basic", "Mask 3"
  preview: string;
  srs: SrsState | undefined;
  state: CardState;
  createdAt: number;
  /** queue position among the deck's new cards, like Anki's "New #12" */
  newPos?: number;
}

function stateOf(srs: SrsState | undefined): CardState {
  if (!srs || srs.reps === 0) {
    if (srs?.suspended) return "suspended";
    if (srs?.buriedUntil && srs.buriedUntil > Date.now()) return "buried";
    return "new";
  }
  if (srs.suspended) return "suspended";
  if (srs.buriedUntil && srs.buriedUntil > Date.now()) return "buried";
  return srs.phase === "review" ? "review" : "learning";
}

function dueText(row: Row): string {
  if (row.state === "new") return row.newPos ? `New #${row.newPos}` : "New";
  if (row.state === "suspended") return "suspended";
  const due = row.srs!.due;
  const delta = due - Date.now();
  if (delta <= 0) return "now";
  if (delta < 86400000 * 30) return formatDelay(delta);
  return new Date(due).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function plain(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function BrowsePage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [data, setData] = useState<StudyData | null>(null);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<CardState | null>(null);
  const [deckFilter, setDeckFilter] = useState<string[] | null>(() => {
    const raw = searchParams.get("deck");
    return raw ? raw.split(",").filter(Boolean) : null;
  });
  const [kindFilter, setKindFilter] = useState<NoteKind | null>(null);
  const [flagFilter, setFlagFilter] = useState<FlagColor | "marked" | null>(null);
  const [todayFilter, setTodayFilter] = useState<TodayFilter | null>(null);
  const [sort, setSort] = useState<{ col: SortCol; dir: 1 | -1 }>({
    col: "deck",
    dir: 1,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [showReplace, setShowReplace] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");

  useEffect(() => {
    if (!user) return;
    return watchDecks(user.uid, setDecks);
  }, [user]);

  const reload = useCallback(async () => {
    if (!user || !decks) return;
    setData(await loadStudyData(user.uid, decks.map((d) => d.id)));
  }, [user, decks]);

  useEffect(() => {
    reload();
  }, [reload]);

  const deckById = useMemo(
    () => new Map((decks ?? []).map((d) => [d.id, d])),
    [decks]
  );

  const allRows = useMemo<Row[]>(() => {
    if (!data) return [];
    const out: Row[] = [];
    const sortedCards = [...data.cards].sort((a, b) => a.createdAt - b.createdAt);
    for (const card of sortedCards) {
      if (card.data.type === "basic") {
        const key = `${card.deckId}|${card.id}`;
        const srs = data.srs.get(key);
        out.push({
          item: {
            kind: "text",
            deckId: card.deckId,
            key: card.id,
            cardId: card.id,
            frontHtml: card.data.front,
            backHtml: card.data.back,
            backPlain: "",
            frontPlain: "",
            isCloze: false,
          },
          key,
          noteId: card.id,
          deck: deckById.get(card.deckId),
          kind: "basic",
          typeLabel: "Basic",
          preview: plain(card.data.front),
          srs,
          state: stateOf(srs),
          createdAt: card.createdAt,
        });
      } else {
        const nums = [
          ...new Set(
            [...card.data.text.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]))
          ),
        ].sort((a, b) => a - b);
        for (const n of nums) {
          const key = `${card.deckId}|${card.id}-c${n}`;
          const srs = data.srs.get(key);
          out.push({
            item: {
              kind: "text",
              deckId: card.deckId,
              key: `${card.id}-c${n}`,
              cardId: card.id,
              frontHtml: card.data.text,
              backHtml: card.data.text,
              backPlain: "",
              frontPlain: "",
              isCloze: true,
            },
            key,
            noteId: card.id,
            deck: deckById.get(card.deckId),
            kind: "cloze",
            typeLabel: `Cloze ${n}`,
            preview: plain(card.data.text),
            srs,
            state: stateOf(srs),
            createdAt: card.createdAt,
          });
        }
      }
    }
    for (const sheet of data.sheets) {
      // one row per study unit, like Anki's one row per IO card
      const seenGroups = new Set<string>();
      let unitIndex = 0;
      for (const shape of sheet.shapes) {
            let unitKey: string;
            if (shape.groupId) {
              if (seenGroups.has(shape.groupId)) continue;
              seenGroups.add(shape.groupId);
              unitKey = `g:${shape.groupId}`;
            } else {
              unitKey = shape.id;
            }
            unitIndex++;
            const key = `${sheet.deckId}|${sheet.id}-${unitKey}`;
            const srs = data.srs.get(key);
            out.push({
              item: {
                kind: "occlusion",
                deckId: sheet.deckId,
                key: `${sheet.id}-${unitKey}`,
                sheet,
                unit: { key: unitKey, shapeIds: [shape.id], label: shape.label },
              },
              key,
              noteId: sheet.id,
              deck: deckById.get(sheet.deckId),
              kind: "occlusion",
              typeLabel: `Mask ${unitIndex}`,
              preview: shape.label?.trim() || sheet.title,
              srs,
              state: stateOf(srs),
              createdAt: sheet.createdAt,
            });
      }
    }
    // Anki-style queue positions for new cards, per deck in creation order.
    const counters = new Map<string, number>();
    for (const row of out) {
      if (row.state !== "new") continue;
      const n = (counters.get(row.item.deckId) ?? 0) + 1;
      counters.set(row.item.deckId, n);
      row.newPos = n;
    }
    return out;
  }, [data, deckById]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((row) => {
      if (stateFilter && row.state !== stateFilter) return false;
      if (todayFilter) {
        const now = Date.now();
        const dayStart = startOfStudyDay(now);
        if (todayFilter === "due") {
          const ok =
            row.srs !== undefined &&
            row.state !== "suspended" &&
            row.state !== "buried" &&
            row.state !== "new" &&
            row.srs.due <= now;
          if (!ok) return false;
        } else if (todayFilter === "overdue") {
          const ok =
            row.state === "review" && row.srs !== undefined && row.srs.due < dayStart;
          if (!ok) return false;
        } else if (todayFilter === "added") {
          if (row.createdAt < dayStart) return false;
        } else if (todayFilter === "studied") {
          if ((row.srs?.lastReviewed ?? 0) < dayStart) return false;
        }
      }
      if (deckFilter && !deckFilter.includes(row.item.deckId)) return false;
      if (kindFilter && row.kind !== kindFilter) return false;
      if (flagFilter === "marked" && !row.srs?.marked) return false;
      if (flagFilter && flagFilter !== "marked" && row.srs?.flag !== flagFilter)
        return false;
      if (q && !row.preview.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allRows, search, stateFilter, deckFilter, kindFilter, flagFilter, todayFilter]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const dir = sort.dir;
    rows.sort((a, b) => {
      switch (sort.col) {
        case "preview":
          return dir * a.preview.localeCompare(b.preview);
        case "type":
          return dir * a.typeLabel.localeCompare(b.typeLabel, undefined, { numeric: true });
        case "state":
          return dir * (STATE_ORDER[a.state] - STATE_ORDER[b.state]);
        case "due":
          return dir * (dueSortValue(a) - dueSortValue(b));
        case "deck": {
          const byDeck = normalizeDeckPath(a.deck?.name ?? "").localeCompare(
            normalizeDeckPath(b.deck?.name ?? "")
          );
          return byDeck !== 0 ? dir * byDeck : dueSortValue(a) - dueSortValue(b);
        }
      }
    });
    return rows;
  }, [filtered, sort]);

  function toggleSort(col: SortCol) {
    setSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 }
    );
  }

  const stateCounts = useMemo(() => {
    const counts = { new: 0, learning: 0, review: 0, suspended: 0, buried: 0 };
    for (const row of allRows) counts[row.state]++;
    return counts;
  }, [allRows]);

  const selectedRows = useMemo(
    () => filtered.filter((r) => selected.has(r.key)),
    [filtered, selected]
  );
  const singleTextRow =
    selectedRows.length === 1 && selectedRows[0].item.kind === "text"
      ? selectedRows[0]
      : null;
  const singleOccRow =
    selectedRows.length === 1 && selectedRows[0].item.kind === "occlusion"
      ? selectedRows[0]
      : null;

  function toggleRow(key: string, additive: boolean) {
    setSelected((prev) => {
      const next = additive ? new Set(prev) : new Set<string>();
      if (prev.has(key) && additive) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === filtered.length
        ? new Set()
        : new Set(filtered.map((r) => r.key))
    );
  }

  /** Applies an SRS patch to every selected row, per its own deck. */
  async function patchSelected(patch: Partial<SrsState>, label: string) {
    if (!user) return;
    setBusy(label);
    try {
      for (const row of selectedRows) {
        const next = { ...(row.srs ?? newSrsState()), ...patch };
        await setSrsState(user.uid, row.item.deckId, row.item.key, next);
      }
      await reload();
    } finally {
      setBusy(null);
    }
  }

  const anySuspended = selectedRows.some((r) => r.srs?.suspended);

  async function handleDelete() {
    if (!user) return;
    const notes = new Map<string, Row>();
    for (const row of selectedRows) notes.set(`${row.item.deckId}|${row.noteId}`, row);
    if (
      !confirm(
        `Delete ${notes.size} note${notes.size === 1 ? "" : "s"}? This removes every card they generate and cannot be undone.`
      )
    ) {
      return;
    }
    setBusy("delete");
    try {
      for (const row of notes.values()) {
        if (row.item.kind === "text") {
          await deleteCard(user.uid, row.item.deckId, row.noteId);
          // clear orphaned schedules
          for (const r of allRows) {
            if (r.noteId === row.noteId && r.srs) {
              await deleteSrsState(user.uid, r.item.deckId, r.item.key).catch(() => {});
            }
          }
        } else {
          await deleteOcclusionSheet(
            user.uid,
            row.item.deckId,
            row.item.sheet.id,
            row.item.sheet.imagePath,
            row.item.sheet.linkedImage
          );
        }
      }
      setSelected(new Set());
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function handleMove() {
    if (!user || !moveTarget) return;
    setBusy("move");
    try {
      // Group note ids per source deck; occlusion moves take the whole sheet.
      const cardsByDeck = new Map<string, Set<string>>();
      const sheetsByDeck = new Map<string, Set<string>>();
      for (const row of selectedRows) {
        const map = row.item.kind === "text" ? cardsByDeck : sheetsByDeck;
        const set = map.get(row.item.deckId) ?? new Set();
        set.add(row.noteId);
        map.set(row.item.deckId, set);
      }
      for (const [from, ids] of cardsByDeck) {
        await moveCardsToDeck(user.uid, from, moveTarget, [...ids]);
      }
      for (const [from, ids] of sheetsByDeck) {
        await moveSheetsToDeck(user.uid, from, moveTarget, [...ids]);
      }
      setSelected(new Set());
      setMoveTarget("");
      await reload();
    } finally {
      setBusy(null);
    }
  }

  if (!user || decks === null || data === null) {
    return (
      <Layout>
        <div className="py-24 text-center text-slate-400">Loading your collection…</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Browse</h1>
          <p className="text-sm text-slate-500">
            {filtered.length.toLocaleString()} of {allRows.length.toLocaleString()}{" "}
            cards{selected.size > 0 && ` · ${selected.size} selected`}
          </p>
        </div>
        <div className="ml-auto flex min-w-[16rem] flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 sm:max-w-md">
          <Search size={15} className="shrink-0 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search card text…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-4">
        {/* ---- sidebar ---- */}
        <aside className="hidden w-52 shrink-0 space-y-4 lg:block">
          <SidebarSection title="Today">
            {(Object.keys(TODAY_LABELS) as TodayFilter[]).map((t) => (
              <SidebarRow
                key={t}
                active={todayFilter === t}
                onClick={() => setTodayFilter(todayFilter === t ? null : t)}
              >
                {TODAY_LABELS[t]}
              </SidebarRow>
            ))}
          </SidebarSection>

          <SidebarSection title="Card state">
            {(Object.keys(STATE_LABELS) as CardState[]).map((s) => (
              <SidebarRow
                key={s}
                active={stateFilter === s}
                onClick={() => setStateFilter(stateFilter === s ? null : s)}
                right={stateCounts[s]}
              >
                {STATE_LABELS[s]}
              </SidebarRow>
            ))}
          </SidebarSection>

          <SidebarSection title="Flags">
            {(Object.keys(FLAG_COLORS) as FlagColor[]).map((f) => (
              <SidebarRow
                key={f}
                active={flagFilter === f}
                onClick={() => setFlagFilter(flagFilter === f ? null : f)}
              >
                <span className="flex items-center gap-2">
                  <Flag size={12} fill={FLAG_COLORS[f]} color={FLAG_COLORS[f]} />
                  <span className="capitalize">{f}</span>
                </span>
              </SidebarRow>
            ))}
            <SidebarRow
              active={flagFilter === "marked"}
              onClick={() => setFlagFilter(flagFilter === "marked" ? null : "marked")}
            >
              <span className="flex items-center gap-2">
                <Star size={12} fill="#f59e0b" color="#f59e0b" /> Marked
              </span>
            </SidebarRow>
          </SidebarSection>

          <SidebarSection title="Note type">
            {(["cloze", "basic", "occlusion"] as NoteKind[]).map((k) => (
              <SidebarRow
                key={k}
                active={kindFilter === k}
                onClick={() => setKindFilter(kindFilter === k ? null : k)}
              >
                <span className="capitalize">{k}</span>
              </SidebarRow>
            ))}
          </SidebarSection>

          <SidebarSection title="Decks">
            {[...decks]
              .sort((a, b) =>
                normalizeDeckPath(a.name).localeCompare(normalizeDeckPath(b.name))
              )
              .map((d) => {
                const parts = splitDeckPath(d.name);
                return (
                  <SidebarRow
                    key={d.id}
                    active={deckFilter?.length === 1 && deckFilter[0] === d.id}
                    onClick={() =>
                      setDeckFilter(
                        deckFilter?.length === 1 && deckFilter[0] === d.id
                          ? null
                          : [d.id]
                      )
                    }
                  >
                    <span
                      className="block truncate"
                      style={{ paddingLeft: `${(parts.length - 1) * 10}px` }}
                      title={normalizeDeckPath(d.name)}
                    >
                      {parts[parts.length - 1]}
                    </span>
                  </SidebarRow>
                );
              })}
          </SidebarSection>
        </aside>

        {/* ---- table + edit pane ---- */}
        <div className="min-w-0 flex-1">
          {selected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm">
              <span className="font-semibold text-indigo-800">
                {selected.size} selected
              </span>
              <span className="mx-1 h-4 w-px bg-indigo-200" />
              <select
                value={moveTarget}
                onChange={(e) => setMoveTarget(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs outline-none"
              >
                <option value="">Change deck…</option>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {normalizeDeckPath(d.name)}
                  </option>
                ))}
              </select>
              {moveTarget && (
                <BulkButton onClick={handleMove} busy={busy === "move"}>
                  <ArrowRightLeft size={13} /> Move
                </BulkButton>
              )}
              <BulkButton
                onClick={() =>
                  patchSelected({ suspended: !anySuspended }, "suspend")
                }
                busy={busy === "suspend"}
              >
                {anySuspended ? <Play size={13} /> : <Pause size={13} />}
                {anySuspended ? "Unsuspend" : "Suspend"}
              </BulkButton>
              <BulkButton
                onClick={() => patchSelected({ buriedUntil: nextDayStart() }, "bury")}
                busy={busy === "bury"}
              >
                <Moon size={13} /> Bury
              </BulkButton>
              <span className="flex items-center gap-1">
                {(Object.keys(FLAG_COLORS) as FlagColor[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => patchSelected({ flag: f }, "flag")}
                    className="h-4 w-4 rounded-full border border-white shadow-sm"
                    style={{ backgroundColor: FLAG_COLORS[f] }}
                    title={`Flag ${f}`}
                  />
                ))}
                <button
                  onClick={() => patchSelected({ flag: null }, "flag")}
                  className="ml-0.5 text-[10px] text-slate-500 hover:text-slate-700"
                >
                  clear
                </button>
              </span>
              <BulkButton onClick={() => setShowReplace(true)}>
                <Replace size={13} /> Find & replace
              </BulkButton>
              <BulkButton danger onClick={handleDelete} busy={busy === "delete"}>
                <Trash2 size={13} /> Delete
              </BulkButton>
              <button
                onClick={() => setSelected(new Set())}
                className="ml-auto text-xs text-indigo-500 hover:text-indigo-700"
              >
                Clear
              </button>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[2rem_1fr_5.5rem_5.5rem_6rem_9rem] items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              <input
                type="checkbox"
                checked={filtered.length > 0 && selected.size === filtered.length}
                onChange={toggleAll}
                className="h-3.5 w-3.5"
              />
              <HeaderCell col="preview" sort={sort} onSort={toggleSort}>
                Card
              </HeaderCell>
              <HeaderCell col="type" sort={sort} onSort={toggleSort}>
                Type
              </HeaderCell>
              <HeaderCell col="state" sort={sort} onSort={toggleSort}>
                State
              </HeaderCell>
              <HeaderCell col="due" sort={sort} onSort={toggleSort}>
                Due
              </HeaderCell>
              <HeaderCell col="deck" sort={sort} onSort={toggleSort}>
                Deck
              </HeaderCell>
            </div>
            <div className="max-h-[58vh] overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-slate-400">
                  Nothing matches these filters.
                </p>
              ) : (
                sorted.slice(0, 1000).map((row) => (
                  <div
                    key={row.key}
                    onClick={(e) => toggleRow(row.key, e.metaKey || e.ctrlKey || e.shiftKey)}
                    className={`grid cursor-pointer grid-cols-[2rem_1fr_5.5rem_5.5rem_6rem_9rem] items-center gap-2 border-b border-slate-50 px-3 py-1.5 text-sm transition last:border-b-0 ${
                      selected.has(row.key) ? "bg-indigo-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(row.key)}
                      onChange={() => toggleRow(row.key, true)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-3.5 w-3.5"
                    />
                    <span className="flex min-w-0 items-center gap-1.5">
                      {row.srs?.flag && (
                        <Flag
                          size={11}
                          className="shrink-0"
                          fill={FLAG_COLORS[row.srs.flag]}
                          color={FLAG_COLORS[row.srs.flag]}
                        />
                      )}
                      {row.srs?.marked && (
                        <Star size={11} className="shrink-0" fill="#f59e0b" color="#f59e0b" />
                      )}
                      <span className="truncate text-slate-800">{row.preview || "(empty)"}</span>
                    </span>
                    <span className="text-xs text-slate-500">{row.typeLabel}</span>
                    <span
                      className={`text-xs font-medium ${
                        {
                          new: "text-sky-500",
                          learning: "text-orange-500",
                          review: "text-emerald-600",
                          suspended: "text-slate-400",
                          buried: "text-slate-400",
                        }[row.state]
                      }`}
                    >
                      {STATE_LABELS[row.state]}
                    </span>
                    <span className="text-xs text-slate-500">{dueText(row)}</span>
                    <span
                      className="truncate text-xs text-slate-400"
                      title={row.deck ? normalizeDeckPath(row.deck.name) : ""}
                    >
                      {row.deck ? normalizeDeckPath(row.deck.name) : "?"}
                    </span>
                  </div>
                ))
              )}
              {sorted.length > 1000 && (
                <p className="px-4 py-2 text-center text-xs text-slate-400">
                  Showing the first 1,000 rows — narrow the filters to see the rest.
                </p>
              )}
            </div>
          </div>

          {selectedRows.length === 1 && (
            <CardInfoStrip row={selectedRows[0]} />
          )}
          {singleTextRow && (
            <InlineEditor
              key={singleTextRow.key}
              onSave={async (front, back) => {
                const card = data.cards.find(
                  (c) => c.deckId === singleTextRow.item.deckId && c.id === singleTextRow.noteId
                );
                if (!card) return;
                await updateCard(
                  user.uid,
                  singleTextRow.item.deckId,
                  singleTextRow.noteId,
                  card.data.type === "basic"
                    ? { type: "basic", front, back }
                    : { type: "cloze", text: front, extra: back || undefined }
                );
                await reload();
              }}
              cardData={
                data.cards.find(
                  (c) => c.deckId === singleTextRow.item.deckId && c.id === singleTextRow.noteId
                )?.data
              }
            />
          )}
          {singleOccRow && singleOccRow.item.kind === "occlusion" && (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-sm text-slate-600">
                Occlusion mask on <b>{singleOccRow.item.sheet.title}</b>
              </p>
              <Link
                to={`/deck/${singleOccRow.item.deckId}/occlusion/${singleOccRow.item.sheet.id}/edit`}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                <ScanEye size={13} /> Open mask editor
              </Link>
            </div>
          )}
        </div>
      </div>

      {showReplace && (
        <FindReplaceModal
          count={
            new Set(
              selectedRows.filter((r) => r.item.kind === "text").map((r) => r.noteId)
            ).size
          }
          onClose={() => setShowReplace(false)}
          onApply={async (find, replace) => {
            if (!user) return 0;
            const notes = new Map<string, Row>();
            for (const r of selectedRows) {
              if (r.item.kind === "text") notes.set(`${r.item.deckId}|${r.noteId}`, r);
            }
            let changed = 0;
            for (const row of notes.values()) {
              const card = data.cards.find(
                (c) => c.deckId === row.item.deckId && c.id === row.noteId
              );
              if (!card) continue;
              const d = card.data;
              if (d.type === "basic") {
                if (d.front.includes(find) || d.back.includes(find)) {
                  await updateCard(user.uid, row.item.deckId, row.noteId, {
                    type: "basic",
                    front: d.front.split(find).join(replace),
                    back: d.back.split(find).join(replace),
                  });
                  changed++;
                }
              } else if (d.text.includes(find) || (d.extra ?? "").includes(find)) {
                await updateCard(user.uid, row.item.deckId, row.noteId, {
                  type: "cloze",
                  text: d.text.split(find).join(replace),
                  extra: d.extra ? d.extra.split(find).join(replace) : undefined,
                });
                changed++;
              }
            }
            await reload();
            return changed;
          }}
        />
      )}
    </Layout>
  );
}

function HeaderCell({
  col,
  sort,
  onSort,
  children,
}: {
  col: SortCol;
  sort: { col: SortCol; dir: 1 | -1 };
  onSort: (col: SortCol) => void;
  children: React.ReactNode;
}) {
  const active = sort.col === col;
  return (
    <button
      onClick={() => onSort(col)}
      className={`flex items-center gap-0.5 text-left uppercase tracking-wide transition hover:text-slate-600 ${
        active ? "text-slate-600" : ""
      }`}
    >
      {children}
      {active && <span>{sort.dir === 1 ? "▲" : "▼"}</span>}
    </button>
  );
}

/** Anki's Card Info, condensed: everything the scheduler knows about a card. */
function CardInfoStrip({ row }: { row: Row }) {
  const s = row.srs;
  const cells: [string, string][] = [
    ["State", STATE_LABELS[row.state]],
    ["Due", s && row.state !== "new" ? new Date(s.due).toLocaleString() : row.newPos ? `New #${row.newPos}` : "—"],
    ["Interval", s && s.reps > 0 ? `${s.ivl}d` : "—"],
    ["Stability", s?.stab !== undefined ? s.stab.toFixed(1) : "—"],
    ["Difficulty", s?.diff !== undefined ? s.diff.toFixed(1) : "—"],
    ["Reviews", String(s?.reps ?? 0)],
    ["Lapses", String(s?.lapses ?? 0)],
    ["Added", new Date(row.createdAt).toLocaleDateString()],
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
      {cells.map(([label, value]) => (
        <span key={label} className="text-xs text-slate-500">
          {label}: <b className="font-semibold text-slate-700">{value}</b>
        </span>
      ))}
    </div>
  );
}

function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-1.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-400"
      >
        {title}
        <ChevronDown size={13} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="mt-1 max-h-56 space-y-0.5 overflow-y-auto">{children}</div>}
    </section>
  );
}

function SidebarRow({
  active,
  onClick,
  right,
  children,
}: {
  active: boolean;
  onClick: () => void;
  right?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-sm transition ${
        active ? "bg-indigo-100 font-medium text-indigo-800" : "text-slate-600 hover:bg-slate-50"
      }`}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {right !== undefined && <span className="ml-2 text-xs text-slate-400">{right}</span>}
    </button>
  );
}

function BulkButton({
  onClick,
  busy,
  danger,
  children,
}: {
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
        danger
          ? "border-red-200 bg-white text-red-600 hover:bg-red-50"
          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : children}
    </button>
  );
}

function InlineEditor({
  cardData,
  onSave,
}: {
  cardData?: { type: "basic"; front: string; back: string } | { type: "cloze"; text: string; extra?: string };
  onSave: (front: string, back: string) => Promise<void>;
}) {
  const isCloze = cardData?.type === "cloze";
  const [front, setFront] = useState(
    cardData ? (cardData.type === "basic" ? cardData.front : cardData.text) : ""
  );
  const [back, setBack] = useState(
    cardData ? (cardData.type === "basic" ? cardData.back : cardData.extra ?? "") : ""
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  if (!cardData) return null;

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
          <Pencil size={12} /> Edit {isCloze ? "cloze note" : "card"}
          <span className="font-normal normal-case text-slate-400">
            — changes apply to every card from this note
          </span>
        </p>
        {saved && (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
            <Check size={12} /> Saved
          </span>
        )}
      </div>
      <div className="space-y-3">
        <RichTextEditor
          value={front}
          onChange={(v) => {
            setFront(v);
            setSaved(false);
          }}
          cloze={isCloze}
          minHeightClass="min-h-16"
        />
        <RichTextEditor
          value={back}
          onChange={(v) => {
            setBack(v);
            setSaved(false);
          }}
          placeholder={isCloze ? "Extra (optional)" : "Back"}
          minHeightClass="min-h-12"
        />
        <div className="flex justify-end">
          <button
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(front, back);
                setSaved(true);
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FindReplaceModal({
  count,
  onApply,
  onClose,
}: {
  count: number;
  onApply: (find: string, replace: string) => Promise<number>;
  onClose: () => void;
}) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<number | null>(null);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Find & replace</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          Runs across the {count} selected note{count === 1 ? "" : "s"} — every
          field, exact text match.
        </p>
        {result !== null ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            Updated {result} note{result === 1 ? "" : "s"}.
            <button
              onClick={onClose}
              className="mt-3 block w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              autoFocus
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <input
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="Replace with…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <button
              onClick={async () => {
                if (!find) return;
                setBusy(true);
                try {
                  setResult(await onApply(find, replace));
                } finally {
                  setBusy(false);
                }
              }}
              disabled={busy || !find || count === 0}
              className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "Replacing…" : "Replace in selected notes"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
