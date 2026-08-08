import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, History, Layers, PenLine, Sparkles, Zap } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useStudyMode } from "../contexts/StudyModeContext";
import { Layout } from "../components/Layout";
import { watchDecks } from "../lib/firestore";
import { computeDeckCounts, type DeckCounts } from "../lib/deckCounts";
import { loadRecentDecks } from "../lib/recents";
import { deckLeafName, deckParentPath, splitDeckPath } from "../lib/deckPath";
import type { Deck } from "../types";

/** The three ways a Quizlet-mode session can ask you a deck. */
const FORMATS = [
  { id: "flashcards", label: "Flashcards", icon: Layers },
  { id: "learn", label: "Learn", icon: Sparkles },
  { id: "write", label: "Write", icon: PenLine },
] as const;

export function QuizletHome() {
  const { user } = useAuth();
  const { studyMode, setStudyMode } = useStudyMode();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [counts, setCounts] = useState<Map<string, DeckCounts>>(new Map());
  const recents = useMemo(() => loadRecentDecks(), []);

  useEffect(() => {
    if (studyMode !== "quizlet") setStudyMode("quizlet");
  }, [studyMode, setStudyMode]);

  useEffect(() => {
    if (!user) return;
    return watchDecks(user.uid, setDecks);
  }, [user]);

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

  const byId = useMemo(
    () => new Map((decks ?? []).map((d) => [d.id, d])),
    [decks]
  );

  const recentDecks = useMemo(
    () =>
      recents
        .map((r) => byId.get(r.deckId))
        .filter((d): d is Deck => Boolean(d))
        .slice(0, 4),
    [recents, byId]
  );

  /** Decks you've been getting wrong, hardest first. */
  const needsPractice = useMemo(() => {
    if (!decks) return [];
    return decks
      .map((deck) => ({ deck, p: counts.get(deck.id)?.practice }))
      .filter((x) => x.p && x.p.total > 0 && (x.p.shaky > 0 || (x.p.accuracy ?? 1) < 0.8))
      .sort((a, b) => (a.p!.accuracy ?? 1) - (b.p!.accuracy ?? 1))
      .slice(0, 5);
  }, [decks, counts]);

  /** Decks with cards, grouped under their parent path so the list reads as
   *  a hierarchy instead of repeating "A::B::C" on every row. */
  const grouped = useMemo(() => {
    const withCards = (decks ?? []).filter(
      (d) => (counts.get(d.id)?.practice.total ?? 0) > 0
    );
    const map = new Map<string, Deck[]>();
    for (const deck of withCards) {
      const key = deckParentPath(deck.name);
      const list = map.get(key) ?? [];
      list.push(deck);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [decks, counts]);

  const studyableCount = grouped.reduce((n, [, list]) => n + list.length, 0);

  return (
    <Layout>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">Quizlet</h1>
        <p className="text-sm text-slate-500">
          Practice as much as you like — nothing here changes your Anki
          schedule.
        </p>
      </div>

      {decks === null ? (
        <div className="py-20 text-center text-slate-400">Loading your decks…</div>
      ) : decks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <Zap className="mx-auto mb-3 text-slate-300" size={36} />
          <p className="mb-1 font-medium text-slate-700">No decks yet</p>
          <Link to="/decks" className="text-sm font-semibold text-red-600 hover:underline">
            Create your first deck
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          {recentDecks.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                <History size={13} /> Recent
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {recentDecks.map((deck) => (
                  <Link
                    key={deck.id}
                    to={`/deck/${deck.id}/study`}
                    className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-red-300 hover:shadow-md"
                  >
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {deckLeafName(deck.name)}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {deckParentPath(deck.name)
                        ? splitDeckPath(deckParentPath(deck.name)).join(" › ") + " · "
                        : ""}
                      {counts.get(deck.id)?.practice.total ?? 0} cards
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {needsPractice.length > 0 && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5">
              <h2 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-amber-900">
                <AlertTriangle size={15} /> Needs more practice
              </h2>
              <p className="mb-3 text-xs text-amber-800/70">
                Decks where you've been missing more than you'd like.
              </p>
              <ul className="space-y-1.5">
                {needsPractice.map(({ deck, p }) => (
                  <li key={deck.id}>
                    <Link
                      to={`/deck/${deck.id}/study?format=learn`}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                        {deckLeafName(deck.name)}
                        {deckParentPath(deck.name) && (
                          <span className="ml-1.5 text-xs font-normal text-slate-400">
                            {splitDeckPath(deckParentPath(deck.name)).join(" › ")}
                          </span>
                        )}
                      </span>
                      {p!.shaky > 0 && (
                        <span className="shrink-0 text-xs font-semibold text-amber-700">
                          {p!.shaky} shaky
                        </span>
                      )}
                      {p!.accuracy !== null && (
                        <span className="w-12 shrink-0 text-right text-xs font-bold text-slate-500">
                          {Math.round(p!.accuracy * 100)}%
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              All decks — pick how you want to study
            </div>
            {studyableCount === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                Your decks are empty. Add some cards first.
              </p>
            ) : (
              <ul>
                {grouped.map(([parent, list]) => (
                  <li key={parent || "__root"}>
                    {parent && (
                      <p className="border-b border-slate-100 bg-slate-50/70 px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                        {splitDeckPath(parent).join(" › ")}
                      </p>
                    )}
                    <ul>
                      {list.map((deck) => (
                  <li
                    key={deck.id}
                    className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-b-0 hover:bg-slate-50"
                  >
                    <Link
                      to={`/deck/${deck.id}`}
                      className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 hover:text-red-600"
                      style={{ paddingLeft: parent ? "0.75rem" : 0 }}
                    >
                      {deckLeafName(deck.name)}
                    </Link>
                    <span className="shrink-0 text-xs text-slate-400">
                      {counts.get(deck.id)?.practice.total ?? 0} cards
                    </span>
                    <div className="flex shrink-0 gap-1">
                      {FORMATS.map(({ id, label, icon: Icon }) => (
                        <Link
                          key={id}
                          to={`/deck/${deck.id}/study?format=${id}`}
                          className="flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-red-400 hover:bg-red-50 hover:text-red-700"
                        >
                          <Icon size={12} /> {label}
                        </Link>
                      ))}
                    </div>
                  </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Layout>
  );
}
