import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  FileText,
  Layers,
  NotebookPen,
  Repeat,
  Scissors,
  Sparkles,
  Zap,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Layout } from "../components/Layout";
import { watchDecks, watchNotes } from "../lib/firestore";
import { computeAllDeckCounts, type DeckCounts } from "../lib/deckCounts";
import { getTodayAnkiStats } from "../lib/settings";
import type { Deck, Note } from "../types";
import { stripHtmlInline } from "../lib/text";
import { DeckLabel } from "../components/DeckLabel";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function plainText(html: string): string {
  return stripHtmlInline(html);
}

export function HomePage() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [counts, setCounts] = useState<Map<string, DeckCounts>>(new Map());
  const today = getTodayAnkiStats();

  useEffect(() => {
    if (!user) return;
    const u1 = watchDecks(user.uid, setDecks);
    const u2 = watchNotes(user.uid, setNotes);
    return () => {
      u1();
      u2();
    };
  }, [user]);

  // Due counts per deck, loaded in the background.
  const [countsNonce, setCountsNonce] = useState(0);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setCountsNonce((n) => n + 1);
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    if (!user || !decks || decks.length === 0) return;
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
  }, [user, decks, countsNonce]);

  const totals = useMemo(() => {
    let newRaw = 0;
    let learnCount = 0;
    let dueRaw = 0;
    let dueTomorrow = 0;
    let newAllowance = Infinity;
    let reviewAllowance = Infinity;
    for (const c of counts.values()) {
      newRaw += c.newRaw;
      learnCount += c.learnCount;
      dueRaw += c.dueRaw;
      dueTomorrow += c.dueTomorrow;
      newAllowance = Math.min(newAllowance, c.newAllowance);
      reviewAllowance = Math.min(reviewAllowance, c.reviewAllowance);
    }
    const newCount = Math.min(newRaw, newAllowance);
    const dueCount = Math.min(dueRaw, reviewAllowance);
    return {
      newCount,
      learnCount,
      dueCount,
      dueTomorrow,
      total: newCount + learnCount + dueCount,
    };
  }, [counts]);

  /** Decks with the most waiting, so you know where to start. */
  const priorityDecks = useMemo(() => {
    if (!decks) return [];
    return decks
      .map((d) => ({ deck: d, c: counts.get(d.id) }))
      .filter((x) => x.c && x.c.newCount + x.c.learnCount + x.c.dueCount > 0)
      .sort(
        (a, b) =>
          b.c!.dueCount + b.c!.learnCount - (a.c!.dueCount + a.c!.learnCount)
      )
      .slice(0, 4);
  }, [decks, counts]);

  /** Lectures with real content that never became flashcards. */
  const notesNeedingCards = useMemo(() => {
    if (!notes) return [];
    return notes
      .filter((n) => !n.cardsMade && plainText(n.content).length > 80)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 4);
  }, [notes]);

  /** Totals across everything, so the overview isn't only about what's due. */
  const library = useMemo(() => {
    let cards = 0;
    let right = 0;
    let answered = 0;
    for (const c of counts.values()) {
      cards += c.practice.total;
      if (c.practice.accuracy !== null) {
        // Weight each deck's accuracy by its size for a fair overall figure.
        right += c.practice.accuracy * c.practice.total;
        answered += c.practice.total;
      }
    }
    return { cards, accuracy: answered > 0 ? right / answered : null };
  }, [counts]);

  const loading = decks === null || notes === null;
  const empty = !loading && decks!.length === 0 && notes!.length === 0;
  const allDeckIds = (decks ?? []).map((d) => d.id).join(",");

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          {greeting()}
          {user?.displayName ? `, ${user.displayName.split(" ")[0]}` : ""}
        </h1>
        <p className="text-sm text-slate-500">
          {loading
            ? "Loading your study plan…"
            : totals.total > 0
              ? `${totals.total} card${totals.total === 1 ? "" : "s"} waiting for you today.`
              : "Nothing due right now — you're all caught up."}
        </p>
      </div>

      {loading ? (
        <div className="py-24 text-center text-slate-400">Loading…</div>
      ) : empty ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <Sparkles className="mx-auto mb-3 text-slate-300" size={38} />
          <p className="mb-1 font-medium text-slate-700">Let's get you started</p>
          <p className="mb-5 text-sm text-slate-500">
            Make a deck of flashcards, or take notes on a lecture and turn them
            into cards.
          </p>
          <div className="flex justify-center gap-3">
            <Link
              to="/decks"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Create a deck
            </Link>
            <Link
              to="/notes"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-white"
            >
              Take notes
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Today */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-4 p-5">
              <div className="flex flex-1 gap-6">
                <Stat label="New" value={totals.newCount} color="text-sky-500" />
                <Stat label="Learn" value={totals.learnCount} color="text-orange-500" />
                <Stat label="Due" value={totals.dueCount} color="text-emerald-600" />
              </div>
              {totals.total > 0 && allDeckIds && (
                <Link
                  to={`/study-group?ids=${allDeckIds}&name=${encodeURIComponent("everything due")}`}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
                >
                  Study now <ArrowRight size={15} />
                </Link>
              )}
            </div>
            {/* Four facts, each a label over a value. As one wrapping
                sentence these ran into each other — "83% correct so far No
                reviews yet today" reads as one statement about today. A grid
                gives each its own cell, so they stay separate however narrow
                the screen. */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-slate-100 bg-slate-50 px-5 py-3 sm:grid-cols-4">
              <Fact
                label="Today"
                value={
                  today.count > 0
                    ? `${today.count} card${today.count === 1 ? "" : "s"}`
                    : "Nothing yet"
                }
                note={
                  today.count > 0
                    ? `${Math.round(today.ms / 1000)}s · ${(
                        today.ms /
                        1000 /
                        today.count
                      ).toFixed(1)}s a card`
                    : undefined
                }
              />
              <Fact
                label="Tomorrow"
                value={`${totals.dueTomorrow} due`}
                note={totals.dueTomorrow === 0 ? "A clear day" : undefined}
              />
              <Fact
                label="Recalled"
                value={
                  library.accuracy === null
                    ? "—"
                    : `${Math.round(library.accuracy * 100)}%`
                }
                note={library.accuracy === null ? "No answers yet" : "of all answers"}
              />
              <Fact
                label="Library"
                value={`${library.cards} card${library.cards === 1 ? "" : "s"}`}
                note={`${decks!.length} deck${decks!.length === 1 ? "" : "s"} · ${
                  notes!.length
                } note${notes!.length === 1 ? "" : "s"}`}
              />
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              to="/anki"
              className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <Repeat size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-800">Anki</span>
                <span className="block truncate text-xs text-slate-500">
                  {totals.total > 0
                    ? `${totals.total} due today · ${totals.dueTomorrow} tomorrow`
                    : "Caught up — nothing due"}
                </span>
              </span>
              <ArrowRight size={15} className="ml-auto shrink-0 text-slate-300" />
            </Link>
            <Link
              to="/quizlet"
              className="flex items-center gap-3 rounded-2xl border border-red-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-100 text-red-700">
                <Zap size={16} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-slate-800">Quizlet</span>
                <span className="block truncate text-xs text-slate-500">
                  Practice freely — schedule untouched
                </span>
              </span>
              <ArrowRight size={15} className="ml-auto shrink-0 text-slate-300" />
            </Link>
          </div>

          {/* min-w-0 on the items: a grid track's automatic minimum is the
              item's min-content, so without it a long row inside can widen
              the column past the screen. */}
          <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            {/* Start here */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-slate-700">
                <Layers size={15} /> Start here
              </h2>
              {priorityDecks.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  Nothing due. Add cards, or switch to Quizlet mode to practice
                  anyway.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {priorityDecks.map(({ deck, c }) => (
                    <li key={deck.id}>
                      <Link
                        to={`/deck/${deck.id}/study`}
                        className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-slate-50"
                      >
                        <DeckLabel name={deck.name} className="flex-1" />
                        <span className="flex shrink-0 gap-2 text-xs font-bold">
                          <span className="text-sky-500">{c!.newCount}</span>
                          <span className="text-orange-500">{c!.learnCount}</span>
                          <span className="text-emerald-600">{c!.dueCount}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to="/decks"
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline"
              >
                All decks <ArrowRight size={12} />
              </Link>
            </section>

            {/* Notes without cards */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-slate-700">
                <Scissors size={15} /> Notes without cards
              </h2>
              <p className="mb-3 text-xs text-slate-400">
                Lectures you've written up but never turned into flashcards.
              </p>
              {notesNeedingCards.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">
                  {notes!.length === 0
                    ? "No notes yet."
                    : "Every note has cards made from it. Nice."}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {notesNeedingCards.map((n) => (
                    <li key={n.id}>
                      <Link
                        to={`/notes/${n.id}`}
                        className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-slate-50"
                      >
                        <FileText size={15} className="shrink-0 text-slate-400" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-800">
                            {n.title}
                          </span>
                          <span className="block truncate text-xs text-slate-400">
                            {n.className || "Unfiled"}
                            {n.slides.length > 0 && ` · ${n.slides.length} slides`}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to="/notes"
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
              >
                <NotebookPen size={12} /> All notes <ArrowRight size={12} />
              </Link>
            </section>
          </div>
        </div>
      )}
    </Layout>
  );
}

/** One labelled figure in the strip under Today. */
function Fact({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="truncate text-sm font-semibold text-slate-800">{value}</p>
      {note && <p className="truncate text-[11px] text-slate-400">{note}</p>}
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
