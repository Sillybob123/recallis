import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarClock,
  FileText,
  Layers,
  NotebookPen,
  Scissors,
  Sparkles,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useStudyMode } from "../contexts/StudyModeContext";
import { Layout } from "../components/Layout";
import { watchDecks, watchNotes } from "../lib/firestore";
import { computeDeckCounts, type DeckCounts } from "../lib/deckCounts";
import { getTodayAnkiStats } from "../lib/settings";
import type { Deck, Note } from "../types";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function plainText(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html;
  return (d.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function HomePage() {
  const { user } = useAuth();
  const { studyMode } = useStudyMode();
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
  useEffect(() => {
    if (!user || !decks || decks.length === 0) return;
    let cancelled = false;
    (async () => {
      const next = new Map<string, DeckCounts>();
      for (const deck of decks) {
        try {
          next.set(deck.id, await computeDeckCounts(user.uid, deck.id));
        } catch {
          /* deck may have vanished */
        }
        if (cancelled) return;
        setCounts(new Map(next));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, decks]);

  const totals = useMemo(() => {
    let newCount = 0;
    let learnCount = 0;
    let dueCount = 0;
    for (const c of counts.values()) {
      newCount += c.newCount;
      learnCount += c.learnCount;
      dueCount += c.dueCount;
    }
    return { newCount, learnCount, dueCount, total: newCount + learnCount + dueCount };
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
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-slate-100 bg-slate-50 px-5 py-2.5 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <CalendarClock size={13} />
                {today.count > 0
                  ? `${today.count} reviewed today in ${Math.round(today.ms / 1000)}s`
                  : "No reviews yet today"}
              </span>
              <span>
                {decks!.length} deck{decks!.length === 1 ? "" : "s"} ·{" "}
                {notes!.length} note{notes!.length === 1 ? "" : "s"}
              </span>
              <span className="ml-auto">
                Studying in{" "}
                <b className={studyMode === "anki" ? "text-emerald-600" : "text-red-600"}>
                  {studyMode === "anki" ? "Anki" : "Quizlet"}
                </b>{" "}
                mode
              </span>
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
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
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                          {deck.name}
                        </span>
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
