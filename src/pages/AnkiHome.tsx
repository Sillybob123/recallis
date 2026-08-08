import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarClock, Clock, Layers } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useStudyMode } from "../contexts/StudyModeContext";
import { Layout } from "../components/Layout";
import { DeckRows } from "../components/DeckTree";
import { StudySettingsModal } from "../components/StudySettingsModal";
import { watchDecks } from "../lib/firestore";
import { computeAllDeckCounts, type DeckCounts } from "../lib/deckCounts";
import { getTodayAnkiStats, loadAnkiSettings, loadQuizletSettings } from "../lib/settings";
import { buildDeckTree } from "../lib/deckPath";
import type { Deck } from "../types";

export function AnkiHome() {
  const { user } = useAuth();
  const { studyMode, setStudyMode } = useStudyMode();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [counts, setCounts] = useState<Map<string, DeckCounts>>(new Map());
  const [showOptions, setShowOptions] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("collapsedDecks") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const today = getTodayAnkiStats();

  // Landing here means you're studying with spaced repetition.
  useEffect(() => {
    if (studyMode !== "anki") setStudyMode("anki");
  }, [studyMode, setStudyMode]);

  useEffect(() => {
    if (!user) return;
    return watchDecks(user.uid, setDecks);
  }, [user]);

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

  const tree = useMemo(() => buildDeckTree(decks ?? []), [decks]);

  const totals = useMemo(() => {
    let newRaw = 0;
    let learn = 0;
    let dueRaw = 0;
    let tomorrow = 0;
    let newAllowance = Infinity;
    let reviewAllowance = Infinity;
    for (const c of counts.values()) {
      newRaw += c.newRaw;
      learn += c.learnCount;
      dueRaw += c.dueRaw;
      tomorrow += c.dueTomorrow;
      newAllowance = Math.min(newAllowance, c.newAllowance);
      reviewAllowance = Math.min(reviewAllowance, c.reviewAllowance);
    }
    const newCount = Math.min(newRaw, newAllowance);
    const dueCount = Math.min(dueRaw, reviewAllowance);
    return {
      newCount,
      learnCount: learn,
      dueCount,
      tomorrow,
      total: newCount + learn + dueCount,
    };
  }, [counts]);

  function toggleCollapse(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      localStorage.setItem("collapsedDecks", JSON.stringify([...next]));
      return next;
    });
  }

  const allIds = (decks ?? []).map((d) => d.id).join(",");

  return (
    <Layout>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">Anki</h1>
        <p className="text-sm text-slate-500">
          Spaced repetition — cards come back exactly when you're about to
          forget them.
        </p>
      </div>

      <section className="mb-5 overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-5 p-5">
          <Stat label="New" value={totals.newCount} color="text-sky-500" />
          <Stat label="Learn" value={totals.learnCount} color="text-orange-500" />
          <Stat label="Due" value={totals.dueCount} color="text-emerald-600" />
          <div className="ml-auto">
            {totals.total > 0 && allIds ? (
              <Link
                to={`/study-group?ids=${allIds}&name=${encodeURIComponent("everything due")}`}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
              >
                Study all due <ArrowRight size={15} />
              </Link>
            ) : (
              <span className="text-sm font-medium text-slate-400">
                All caught up
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-slate-100 bg-emerald-50/50 px-5 py-2.5 text-xs text-slate-600">
          <span className="flex items-center gap-1.5">
            <Clock size={13} />
            {today.count > 0 ? (
              <>
                Studied <b>{today.count}</b> card{today.count === 1 ? "" : "s"} in{" "}
                <b>{Math.round(today.ms / 1000)}s</b> today
                <span className="text-slate-400">
                  {" "}
                  ({(today.ms / 1000 / today.count).toFixed(1)}s/card)
                </span>
              </>
            ) : (
              "No reviews yet today"
            )}
          </span>
          <span className="flex items-center gap-1.5">
            <CalendarClock size={13} />
            <b>{totals.tomorrow}</b> due tomorrow
          </span>
          <span className="ml-auto">
            {(decks ?? []).length} deck{(decks ?? []).length === 1 ? "" : "s"}
          </span>
        </div>
      </section>

      {decks === null ? (
        <div className="py-20 text-center text-slate-400">Loading your decks…</div>
      ) : decks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <Layers className="mx-auto mb-3 text-slate-300" size={36} />
          <p className="mb-1 font-medium text-slate-700">No decks yet</p>
          <Link
            to="/decks"
            className="text-sm font-semibold text-indigo-600 hover:underline"
          >
            Create your first deck
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            <span className="flex-1">Deck</span>
            <span className="w-9 text-right text-sky-500">New</span>
            <span className="w-9 text-right text-orange-500">Learn</span>
            <span className="w-9 text-right text-emerald-600">Due</span>
            <span className="w-[5.5rem]" />
            <span className="w-7" />
          </div>
          <ul>
            {tree.map((node) => (
              <DeckRows
                key={node.path}
                node={node}
                uid={user!.uid}
                counts={counts}
                collapsed={collapsed}
                onToggle={toggleCollapse}
                onOptions={() => setShowOptions(true)}
                onAddChild={() => {}}
                decks={decks}
              />
            ))}
          </ul>
        </div>
      )}

      {showOptions && (
        <StudySettingsModal
          studyMode="anki"
          anki={loadAnkiSettings()}
          quizlet={loadQuizletSettings()}
          onChange={() => {}}
          onClose={() => setShowOptions(false)}
        />
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
