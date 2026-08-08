import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  ChevronDown,
  CloudOff,
  Loader2,
  Flag,
  PartyPopper,
  Pencil,
  RotateCcw,
  Settings,
  Star,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useStudyMode } from "../contexts/StudyModeContext";
import { Layout } from "../components/Layout";
import { RichText } from "../components/RichText";
import { ShapeOverlay } from "../components/ShapeOverlay";
import { StudySettingsModal } from "../components/StudySettingsModal";
import {
  createCard,
  deleteCard,
  deleteOcclusionSheet,
  deleteSrsState,
  recordCardResult,
  updateCard,
} from "../lib/firestore";
import { CardEditorModal } from "../components/CardEditorModal";
import { findClozeNumbers } from "../lib/cloze";
import { buildUnits } from "../lib/shapes";
import type { Card, OcclusionSheet } from "../types";
import {
  buildOcclusionItems,
  buildTextItems,
  combinedKey,
  itemAnswer,
  type StudyItem,
} from "../lib/studyItems";
import {
  countTodayAcrossDecks,
  getAllActiveDeckIds,
  loadStudyData,
} from "../lib/studyLoad";
import {
  loadAnkiSettings,
  loadQuizletSettings,
  recordAnkiReview,
  startOfStudyDay,
  type AnkiSettings,
  type QuizletSettings,
} from "../lib/settings";
import {
  formatDelay,
  isDue,
  isExcluded,
  isNew,
  nextDayStart,
  previewIntervals,
  rate,
  newSrsState,
  type FlagColor,
  type Rating,
  type SrsConfig,
  type SrsState,
} from "../lib/srs";
import { gradeAnswer, shuffle } from "../lib/text";
import { SrsWriter, type SaveStatus } from "../lib/srsWriter";
import { recordRecentDecks } from "../lib/recents";
import {
  disperseSiblings,
  removeSiblings,
  spreadSiblings,
  MIN_SIBLING_GAP,
} from "../lib/siblings";
import {
  clearCramSession,
  loadCramSession,
  saveCramSession,
} from "../lib/cramSession";

const FAST_ANSWER_MS = 7000;

const FORMAT_LABELS: Record<"flip" | "type" | "learn", string> = {
  flip: "Flashcards",
  type: "Type the answer",
  learn: "Learn",
};

type LearnFormat = "mc" | "written" | "flashcard";

/** Anki-style occlusion rendering (QMask front, OMask outline on back). */
function OcclusionCard({
  item,
  occMode,
  revealed,
}: {
  item: Extract<StudyItem, { kind: "occlusion" }>;
  occMode: "hideOne" | "hideAll";
  revealed: boolean;
}) {
  const targetIds = new Set(item.unit.shapeIds);
  let hiddenIds: Set<string>;
  let outlineIds: Set<string> | undefined;
  if (!revealed) {
    hiddenIds =
      occMode === "hideOne"
        ? targetIds
        : new Set(item.sheet.shapes.map((s) => s.id));
  } else {
    outlineIds = targetIds;
    hiddenIds =
      occMode === "hideAll"
        ? new Set(
            item.sheet.shapes.map((s) => s.id).filter((id) => !targetIds.has(id))
          )
        : new Set();
  }
  return (
    <div>
      <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-slate-200 bg-white">
        <img
          src={item.sheet.imageUrl}
          alt=""
          className="block h-auto w-full select-none"
          draggable={false}
        />
        <ShapeOverlay
          shapes={item.sheet.shapes}
          hiddenIds={hiddenIds}
          targetIds={targetIds}
          outlineIds={outlineIds}
        />
      </div>
      {item.unit.label && revealed && (
        <p className="mt-3 text-center text-lg font-semibold text-slate-900">
          {item.unit.label}
        </p>
      )}
    </div>
  );
}

/** The four Anki grade buttons with interval previews. */
function GradeButtons({
  srs,
  cfg,
  onGrade,
}: {
  srs: SrsState | null;
  cfg: SrsConfig;
  onGrade: (r: Rating) => void;
}) {
  const previews = previewIntervals(srs, Date.now(), cfg);
  const defs: { rating: Rating; label: string; hint: string; cls: string }[] = [
    { rating: "again", label: "Again", hint: "X", cls: "border-red-200 bg-red-50 text-red-600 hover:bg-red-100" },
    { rating: "hard", label: "Hard", hint: "", cls: "border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100" },
    { rating: "good", label: "Good", hint: "Space", cls: "border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100" },
    { rating: "easy", label: "Easy", hint: "", cls: "border-sky-200 bg-sky-50 text-sky-600 hover:bg-sky-100" },
  ];
  return (
    <div className="mx-auto flex max-w-2xl justify-center gap-2">
      {defs.map((d) => (
        <button
          key={d.rating}
          onClick={() => onGrade(d.rating)}
          className={`flex-1 rounded-xl border py-2 transition ${d.cls}`}
        >
          <span className="block text-sm font-semibold">
            {d.label}
            {d.hint && <span className="ml-1 text-[10px] opacity-50">({d.hint})</span>}
          </span>
          <span className="block text-[11px] opacity-70">{previews[d.rating]}</span>
        </button>
      ))}
    </div>
  );
}

export function StudyBasic() {
  const { deckId } = useParams();
  const [searchParams] = useSearchParams();
  const cardsOnly = searchParams.get("only") === "cards";
  const groupIdsParam = searchParams.get("ids");
  const groupName = searchParams.get("name");
  // Studying a parent pools every deck in its subtree, Anki-style.
  const deckIds = deckId
    ? [deckId]
    : (groupIdsParam ?? "").split(",").filter(Boolean);
  const deckScopeKey = deckIds.join(",");
  const cramScope = `${deckScopeKey}:${cardsOnly ? "cards" : "all"}`;
  const { user } = useAuth();
  const { studyMode, setStudyMode } = useStudyMode();
  const navigate = useNavigate();
  const location = useLocation();
  const canGoBack = location.key !== "default";

  const [cards, setCards] = useState<(Card & { deckId: string })[] | null>(null);
  const [sheets, setSheets] = useState<(OcclusionSheet & { deckId: string })[] | null>(null);
  const [srsMap, setSrsMap] = useState<Map<string, SrsState> | null>(null);
  const [ankiSettings, setAnkiSettings] = useState<AnkiSettings>(loadAnkiSettings);
  const [quizletSettings, setQuizletSettings] =
    useState<QuizletSettings>(loadQuizletSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [queue, setQueue] = useState<StudyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [nextDueMs, setNextDueMs] = useState<number | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [mode, setMode] = useState<"flip" | "type" | "learn">(() => {
    // Quizlet home links in with a chosen study format.
    const f = searchParams.get("format");
    if (f === "learn") return "learn";
    if (f === "write") return "type";
    return "flip";
  });
  const [occMode, setOccMode] = useState<"hideOne" | "hideAll">("hideOne");
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState<null | boolean>(null);
  const [mcPicked, setMcPicked] = useState<number | null>(null);
  const [retyped, setRetyped] = useState("");
  const [sessionNonce, setSessionNonce] = useState(0);
  const [formatOpen, setFormatOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [queueReady, setQueueReady] = useState(false);
  // Session performance is deliberately separate from the progress bar: the
  // bar measures cards retired from today's queue, while these count every
  // button press. Failing a card three times before getting it right is one
  // retired card but four answers.
  const [stats, setStats] = useState({ answers: 0, correct: 0, wrong: 0 });

  // Every graded card is written through here so nothing is silently lost.
  const writerRef = useRef<SrsWriter | null>(null);
  if (!writerRef.current) {
    writerRef.current = new SrsWriter((status) => setSaveStatus(status));
  }
  useEffect(() => () => writerRef.current?.dispose(), []);

  // Pending writes are safe (Firestore replays them from IndexedDB), but a
  // rejected one would be lost, so warn before the tab closes on that state.
  useEffect(() => {
    if (saveStatus !== "error") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveStatus]);

  // Session-local memory for the smart Quizlet scheduler.
  const strengthRef = useRef<Map<string, number>>(new Map());
  const shownAtRef = useRef<number>(Date.now());
  const guessMsRef = useRef<number>(0);

  const srsConfig: SrsConfig = {
    learnStepsMin: ankiSettings.learnStepsMin,
    relearnStepsMin: ankiSettings.relearnStepsMin,
    maxIntervalDays: ankiSettings.maxIntervalDays,
    desiredRetention: (ankiSettings.desiredRetentionPct || 90) / 100,
  };

  const reloadData = useCallback(async () => {
    if (!user || deckIds.length === 0) return;
    const data = await loadStudyData(user.uid, deckIds);
    setCards(data.cards);
    setSheets(data.sheets);
    setSrsMap(data.srs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, deckScopeKey]);

  useEffect(() => {
    setCards(null);
    setSheets(null);
    setSrsMap(null);
    setQueueReady(false);
    reloadData();
  }, [reloadData]);

  // Remember what was studied so the Quizlet home can offer it again.
  useEffect(() => {
    if (deckIds.length > 0) recordRecentDecks(deckIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckScopeKey]);

  // Build the session queue once everything is loaded (and rebuild when the
  // study mode toggles — the queues are fundamentally different).
  useEffect(() => {
    if (!cards || !sheets || !srsMap) return;
    setQueueReady(false);
    setStats({ answers: 0, correct: 0, wrong: 0 });
    const all = [
      ...buildTextItems(cards, {
        answerWithTerm:
          studyMode === "quizlet" && quizletSettings.answerWith === "term",
      }),
      ...(cardsOnly ? [] : buildOcclusionItems(sheets)),
    ];
    strengthRef.current = new Map();

    if (studyMode === "quizlet") {
      // Resume an unfinished cram session rather than reshuffling from scratch.
      const saved = loadCramSession(cramScope);
      if (saved) {
        const byKey = new Map(all.map((it) => [combinedKey(it), it]));
        const restored = saved.order
          .map((k) => byKey.get(k))
          .filter((it): it is StudyItem => Boolean(it));
        if (restored.length > 0) {
          strengthRef.current = new Map(saved.strengths);
          setQueue(restored);
          setTotal(Math.max(saved.total, restored.length));
          setNextDueMs(null);
          setQueueReady(true);
          return;
        }
        clearCramSession(cramScope);
      }
      const items = spreadSiblings(shuffle(all), ankiSettings.siblingGap);
      setQueue(items);
      setTotal(items.length);
      setNextDueMs(null);
      setQueueReady(true);
    } else {
      let cancelled = false;
      (async () => {
        const now = Date.now();
        const dayStart = startOfStudyDay(now);
        // Daily counters: normally counted over the decks in this session.
        // With "Limits start from top", studying anywhere eats the same shared
        // budget, so count across ALL decks (one preset, one budget — Anki-style).
        let newToday = 0;
        let reviewsToday = 0;
        if (ankiSettings.limitsStartFromTop && user) {
          const allIds = await getAllActiveDeckIds(user.uid);
          const counts = await countTodayAcrossDecks(user.uid, allIds, dayStart);
          newToday = counts.newToday;
          reviewsToday = counts.reviewsToday;
        } else {
          for (const s of srsMap.values()) {
            if ((s.firstSeen ?? 0) >= dayStart) newToday++;
            if ((s.lastReviewed ?? 0) >= dayStart && s.phase === "review") reviewsToday++;
          }
        }
        if (cancelled) return;

        const available = all.filter(
          (it) => !isExcluded(srsMap.get(combinedKey(it)), now)
        );
        const learning = available.filter((it) => {
          const s = srsMap.get(combinedKey(it));
          return s && !isNew(s) && s.phase !== "review" && isDue(s, now);
        });
        const reviews = available.filter((it) => {
          const s = srsMap.get(combinedKey(it));
          return s && !isNew(s) && s.phase === "review" && isDue(s, now);
        });
        // Gathered in deck order, insertion order — Anki's "ascending position".
        const fresh = available.filter((it) => isNew(srsMap.get(combinedKey(it))));

        reviews.sort(
          (a, b) =>
            (srsMap.get(combinedKey(a))?.due ?? 0) -
            (srsMap.get(combinedKey(b))?.due ?? 0)
        );
        const reviewAllowance = Math.max(
          0,
          ankiSettings.maxReviewsPerDay - reviewsToday
        );
        const cappedReviews = reviews.slice(0, reviewAllowance);

        let newAllowance = Math.max(0, ankiSettings.newPerDay - newToday);
        if (!ankiSettings.newIgnoreReviewLimit) {
          newAllowance = Math.min(
            newAllowance,
            Math.max(0, reviewAllowance - cappedReviews.length)
          );
        }
        const cappedNew = fresh.slice(0, newAllowance);

        const items = spreadSiblings(
          [...learning, ...cappedReviews, ...cappedNew],
          ankiSettings.siblingGap
        );
        if (cancelled) return;
        setQueue(items);
        setTotal(items.length);
        const future = all
          .map((it) => srsMap.get(combinedKey(it))?.due)
          .filter((d): d is number => typeof d === "number" && d > now);
        setNextDueMs(future.length ? Math.min(...future) - now : null);
        setQueueReady(true);
      })();
      return () => {
        cancelled = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    cards === null,
    sheets === null,
    srsMap === null,
    studyMode,
    cardsOnly,
    sessionNonce,
    quizletSettings.answerWith,
  ]);

  const current = queue[0];
  const showMaskToggle = current?.kind === "occlusion";

  // Restart the answer timer whenever a new card is shown.
  useEffect(() => {
    shownAtRef.current = Date.now();
    guessMsRef.current = 0;
  }, [current?.key]);

  // Learn-mode: which format this card gets right now.
  const learnFormat: LearnFormat = useMemo(() => {
    if (!current) return "flashcard";
    if (current.kind === "occlusion" && !current.unit.label) return "flashcard";
    const st = strengthRef.current.get(current.key) ?? 0;
    const { enableMultipleChoice, enableWritten } = quizletSettings;
    if (st === 0 && enableMultipleChoice) return "mc";
    if (enableWritten) return "written";
    if (enableMultipleChoice) return "mc";
    return "flashcard";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key, quizletSettings]);

  // Multiple-choice options for the current card.
  const mcOptions = useMemo(() => {
    if (!current || mode !== "learn" || learnFormat !== "mc") return [];
    const answer = itemAnswer(current);
    const pool = Array.from(
      new Set(
        queue
          .slice(1)
          .map(itemAnswer)
          .filter((a) => a && a !== answer)
      )
    );
    const distractors = shuffle(pool).slice(0, 3);
    return shuffle([answer, ...distractors]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key, mode, learnFormat]);

  function recordAnswer(correct: boolean) {
    setStats((s) => ({
      answers: s.answers + 1,
      correct: s.correct + (correct ? 1 : 0),
      wrong: s.wrong + (correct ? 0 : 1),
    }));
  }

  function resetCardUI() {
    setFlipped(false);
    setTyped("");
    setChecked(null);
    setMcPicked(null);
    setRetyped("");
  }

  function captureGuessTime() {
    if (!guessMsRef.current) {
      guessMsRef.current = Date.now() - shownAtRef.current;
    }
  }

  function reinsert(prev: StudyItem[], item: StudyItem, at: number): StudyItem[] {
    const rest = prev.slice(1);
    const pos = Math.min(at, rest.length);
    return [...rest.slice(0, pos), item, ...rest.slice(pos)];
  }

  /**
   * Keeps the other cards from this note away from the one just answered, so
   * the next sibling is a real recall rather than a read-back of what's still
   * on screen. Bury mode additionally drops them out of today's session.
   */
  function applySiblingPolicy(nextQueue: StudyItem[], answered: StudyItem) {
    const mode = ankiSettings.siblingMode;
    if (mode === "bury") {
      const { queue: pruned, removed } = removeSiblings(nextQueue, answered);
      if (removed.length > 0 && studyMode === "anki") {
        // Persist the bury so they stay hidden until tomorrow, like Anki.
        updateMeta(
          answered.deckId,
          removed.map((item) => item.key),
          { buriedUntil: nextDayStart() }
        );
      }
      return pruned;
    }
    const gap = mode === "off" ? MIN_SIBLING_GAP : ankiSettings.siblingGap;
    return disperseSiblings(nextQueue, answered, gap);
  }

  /** Commits a cram queue to state and to the device, so a refresh resumes. */
  function commitCramQueue(next: StudyItem[], sessionTotal: number) {
    setQueue(next);
    if (next.length === 0) {
      // Finished — nothing about a cram run is worth keeping.
      clearCramSession(cramScope);
    } else {
      saveCramSession(cramScope, {
        order: next.map(combinedKey),
        strengths: [...strengthRef.current.entries()],
        total: sessionTotal,
      });
    }
  }

  function recordStats(item: StudyItem, correct: boolean) {
    if (item.kind !== "text" || !user) return;
    const stats =
      cards!.find((c) => c.deckId === item.deckId && c.id === item.cardId)?.stats ??
      { correct: 0, incorrect: 0 };
    recordCardResult(user.uid, item.deckId, item.cardId, correct, stats).catch(() => {});
  }

  /** Quizlet flashcards mode: adaptive by speed + accuracy. */
  function markCram(correct: boolean) {
    if (!current) return;
    pushHistory();
    recordStats(current, correct);
    recordAnswer(correct);
    const st = strengthRef.current.get(current.key) ?? 0;
    let nextQueue: StudyItem[];
    if (!correct) {
      strengthRef.current.set(current.key, 0);
      nextQueue = reinsert(queue, current, 3);
    } else {
      const fast = guessMsRef.current > 0 && guessMsRef.current < FAST_ANSWER_MS;
      const strength = st + (fast ? 2 : 1);
      strengthRef.current.set(current.key, strength);
      nextQueue =
        strength >= 2
          ? queue.slice(1)
          : reinsert(queue, current, Math.max(8, queue.length - 2));
    }
    commitCramQueue(applySiblingPolicy(nextQueue, current), total);
    resetCardUI();
  }

  /** Quizlet Learn mode: not-learned → familiar (1 correct) → mastered (2). */
  function markLearn(correct: boolean) {
    if (!current) return;
    pushHistory();
    recordStats(current, correct);
    recordAnswer(correct);
    const st = strengthRef.current.get(current.key) ?? 0;
    let nextQueue: StudyItem[];
    if (!correct) {
      strengthRef.current.set(current.key, 0);
      nextQueue = reinsert(queue, current, 3);
    } else {
      const strength = st + 1;
      strengthRef.current.set(current.key, strength);
      nextQueue =
        strength >= 2 ? queue.slice(1) : reinsert(queue, current, Math.min(6, queue.length));
    }
    commitCramQueue(applySiblingPolicy(nextQueue, current), total);
    resetCardUI();
  }

  /** Anki mode: grade → SM-2 schedule persisted; learning steps stay in session. */
  function gradeSrs(rating: Rating) {
    if (!current || !user) return;
    const prev = srsMap?.get(combinedKey(current)) ?? null;
    pushHistory(current, prev);
    recordAnkiReview(Date.now() - shownAtRef.current);
    const next = rate(prev, rating, Date.now(), srsConfig);
    writerRef.current!.write(user.uid, current.deckId, current.key, next);
    setSrsMap((m) => {
      const copy = new Map(m);
      copy.set(combinedKey(current), next);
      return copy;
    });
    recordStats(current, rating !== "again");
    recordAnswer(rating !== "again");
    // Reinsert only if the card is coming back within this sitting; a long
    // relearning step means it leaves today's queue and counts as retired.
    const graded =
      next.due - Date.now() < 20 * 60 * 1000
        ? reinsert(queue, current, 3)
        : queue.slice(1);
    setQueue(applySiblingPolicy(graded, current));
    resetCardUI();
  }

  function handleCheck() {
    if (!current) return;
    captureGuessTime();
    setChecked(gradeAnswer(typed, itemAnswer(current), quizletSettings.grading));
  }

  function restart() {
    clearCramSession(cramScope);
    setSessionNonce((n) => n + 1);
    resetCardUI();
  }

  // ---------- Anki card actions (Edit / More menu) ----------
  const [moreOpen, setMoreOpen] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const historyRef = useRef<
    { queue: StudyItem[]; deckId?: string; key?: string; prevSrs?: SrsState | null }[]
  >([]);

  function pushHistory(item?: StudyItem, prevSrs?: SrsState | null) {
    historyRef.current.push({
      queue,
      deckId: item?.deckId,
      key: item?.key,
      prevSrs,
    });
    if (historyRef.current.length > 25) historyRef.current.shift();
  }

  function siblingKeys(item: StudyItem): string[] {
    if (item.kind === "occlusion") {
      return buildUnits(item.sheet.shapes).map((u) => `${item.sheet.id}-${u.key}`);
    }
    const card = cards?.find((c) => c.deckId === item.deckId && c.id === item.cardId);
    if (!card) return [item.key];
    if (card.data.type === "basic") return [card.id];
    return findClozeNumbers(card.data.text).map((n) => `${card.id}-c${n}`);
  }

  function updateMeta(deckIdFor: string, keys: string[], patch: Partial<SrsState>) {
    if (!user) return;
    setSrsMap((m) => {
      const copy = new Map(m);
      for (const key of keys) {
        const ck = `${deckIdFor}|${key}`;
        const next = { ...(copy.get(ck) ?? newSrsState()), ...patch };
        copy.set(ck, next);
        writerRef.current!.write(user.uid, deckIdFor, key, next);
      }
      return copy;
    });
  }

  function dropFromQueue(keys: string[]) {
    const set = new Set(keys);
    setQueue((prev) => prev.filter((it) => !set.has(it.key)));
    resetCardUI();
  }

  const actions = {
    flag(color: FlagColor | null) {
      if (!current) return;
      updateMeta(current.deckId, [current.key], { flag: color });
    },
    buryCard() {
      if (!current) return;
      pushHistory();
      updateMeta(current.deckId, [current.key], { buriedUntil: nextDayStart() });
      dropFromQueue([current.key]);
    },
    buryNote() {
      if (!current) return;
      pushHistory();
      const keys = siblingKeys(current);
      updateMeta(current.deckId, keys, { buriedUntil: nextDayStart() });
      dropFromQueue(keys);
    },
    suspendCard() {
      if (!current) return;
      pushHistory();
      updateMeta(current.deckId, [current.key], { suspended: true });
      dropFromQueue([current.key]);
    },
    suspendNote() {
      if (!current) return;
      pushHistory();
      const keys = siblingKeys(current);
      updateMeta(current.deckId, keys, { suspended: true });
      dropFromQueue(keys);
    },
    resetCard() {
      if (!current || !user) return;
      if (!confirm("Reset this card? Its schedule is erased and it becomes a new card.")) return;
      deleteSrsState(user.uid, current.deckId, current.key).catch(() => {});
      setSrsMap((m) => {
        const copy = new Map(m);
        copy.delete(combinedKey(current));
        return copy;
      });
    },
    setDueDate() {
      if (!current) return;
      const raw = prompt("Show this card again in how many days? (0 = today)", "1");
      if (raw === null) return;
      const days = Math.max(0, parseInt(raw, 10) || 0);
      const now = Date.now();
      pushHistory();
      updateMeta(current.deckId, [current.key], {
        phase: "review",
        due: now + days * 86400000,
        ivl: Math.max(days, 1),
        stab: Math.max(days, 1),
        reps: Math.max(srsMap?.get(combinedKey(current))?.reps ?? 0, 1),
      });
      if (days > 0) dropFromQueue([current.key]);
    },
    cardInfo() {
      if (!current) return;
      const s = srsMap?.get(combinedKey(current));
      if (!s || isNew(s)) {
        alert("Card info\n\nState: New (never studied in Anki mode)");
        return;
      }
      alert(
        [
          "Card info",
          "",
          `State: ${s.phase}`,
          `Due: ${new Date(s.due).toLocaleString()}`,
          `Interval: ${s.ivl}d`,
          `Stability: ${s.stab?.toFixed(2) ?? "—"}`,
          `Difficulty: ${s.diff?.toFixed(2) ?? "—"}`,
          `Reviews: ${s.reps} · Lapses: ${s.lapses}`,
          `Flag: ${s.flag ?? "none"} · ${s.suspended ? "SUSPENDED" : "active"}${s.marked ? " · MARKED" : ""}`,
        ].join("\n")
      );
    },
    previousCard() {
      const last = historyRef.current.pop();
      if (!last || !user) return;
      setQueue(last.queue);
      if (last.key !== undefined && last.deckId !== undefined) {
        setSrsMap((m) => {
          const copy = new Map(m);
          const ck = `${last.deckId}|${last.key}`;
          if (last.prevSrs) {
            copy.set(ck, last.prevSrs);
            writerRef.current!.write(user.uid, last.deckId!, last.key!, last.prevSrs);
          } else {
            copy.delete(ck);
            deleteSrsState(user.uid, last.deckId!, last.key!).catch(() => {});
          }
          return copy;
        });
      }
      resetCardUI();
    },
    markNote() {
      if (!current) return;
      const marked = !srsMap?.get(current.key)?.marked;
      updateMeta(current.deckId, siblingKeys(current), { marked });
    },
    async createCopy() {
      if (!current || !user) return;
      if (current.kind === "occlusion") {
        alert("Copying an occlusion card isn't supported yet — duplicate the sheet from the deck page instead.");
        return;
      }
      const card = cards?.find((c) => c.deckId === current.deckId && c.id === current.cardId);
      if (card) {
        await createCard(user.uid, current.deckId, card.data);
        alert("Copy created — find it on the deck page to edit.");
      }
    },
    async deleteNote() {
      if (!current || !user) return;
      const keys = siblingKeys(current);
      if (current.kind === "text") {
        if (!confirm("Delete this note and all its cards? This can't be undone.")) return;
        await deleteCard(user.uid, current.deckId, current.cardId);
      } else {
        if (!confirm(`Delete the occlusion sheet "${current.sheet.title}" and all its masks?`)) return;
        await deleteOcclusionSheet(
          user.uid,
          current.deckId,
          current.sheet.id,
          current.sheet.imagePath,
          current.sheet.linkedImage
        );
      }
      dropFromQueue(keys);
    },
  };

  // ---------- keyboard: Space = flip / correct, X = wrong ----------
  const isFlashcardContext =
    current &&
    ((mode === "flip") ||
      (mode === "type" && current.kind === "occlusion" && !current.unit.label) ||
      (mode === "learn" && learnFormat === "flashcard"));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (!current || !isFlashcardContext) return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (!flipped) {
          captureGuessTime();
          setFlipped(true);
        } else if (studyMode === "anki") {
          gradeSrs("good");
        } else if (mode === "learn") {
          markLearn(true);
        } else {
          markCram(true);
        }
      } else if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        if (!flipped) {
          captureGuessTime();
          setFlipped(true);
        } else if (studyMode === "anki") {
          gradeSrs("again");
        } else if (mode === "learn") {
          markLearn(false);
        } else {
          markCram(false);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const progress = total > 0 ? Math.round(((total - queue.length) / total) * 100) : 0;

  if (!cards || !sheets || !srsMap || !queueReady) {
    return (
      <Layout>
        <div className="py-24 text-center text-slate-400">Loading…</div>
      </Layout>
    );
  }

  const settingsButton = (
    <button
      onClick={() => setShowSettings(true)}
      title="Study settings"
      className="rounded-full border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-50"
    >
      <Settings size={14} />
    </button>
  );

  if (total === 0) {
    return (
      <Layout>
        <div className="mb-4 flex items-center gap-3">
          <BackLink deckId={deckId} navigate={navigate} canGoBack={canGoBack} inline />
          <span className="flex-1" />
          {settingsButton}
        </div>
        {studyMode === "anki" ? (
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 py-20 text-center">
            <CalendarClock className="mx-auto mb-3 text-indigo-400" size={40} />
            <p className="mb-1 text-lg font-bold text-indigo-900">
              Nothing due right now
            </p>
            <p className="mb-5 text-sm text-indigo-700">
              {nextDueMs !== null
                ? `You're done for today — the next card comes due in ${formatDelay(nextDueMs)}.`
                : cards.length + sheets.length === 0
                  ? "This deck has no cards yet."
                  : "Everything here is either scheduled for later, suspended, or buried."}{" "}
              Want to practice anyway without touching the schedule?
            </p>
            <button
              onClick={() => setStudyMode("quizlet")}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              Switch to Quizlet mode & cram
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center">
            <p className="font-medium text-slate-700">Nothing to study yet</p>
            <p className="mt-1 text-sm text-slate-500">
              Add cards or an image occlusion sheet from the deck page first.
            </p>
          </div>
        )}
        {showSettings && (
          <StudySettingsModal
            studyMode={studyMode}
            anki={ankiSettings}
            quizlet={quizletSettings}
            onChange={(a, q) => {
              setAnkiSettings(a);
              setQuizletSettings(q);
              restart();
            }}
            onClose={() => setShowSettings(false)}
          />
        )}
      </Layout>
    );
  }

  const currentSrs = current ? srsMap.get(combinedKey(current)) ?? null : null;
  const answer = current ? itemAnswer(current) : "";
  const retypeSatisfied =
    !quizletSettings.retypeCorrect || gradeAnswer(retyped, answer, "moderate");

  function CramButtons({ onMark }: { onMark: (c: boolean) => void }) {
    return (
      <div className="mx-auto flex max-w-2xl justify-center gap-3">
        <button
          onClick={() => onMark(false)}
          className="flex-1 rounded-xl border border-red-200 bg-red-50 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-100"
        >
          Still learning <span className="text-[10px] opacity-50">(X)</span>
        </button>
        <button
          onClick={() => onMark(true)}
          className="flex-1 rounded-xl border border-emerald-200 bg-emerald-50 py-3 text-sm font-semibold text-emerald-600 transition hover:bg-emerald-100"
        >
          Got it <span className="text-[10px] opacity-50">(Space)</span>
        </button>
      </div>
    );
  }

  function AnswerButtons() {
    if (studyMode === "anki") {
      return <GradeButtons srs={currentSrs} cfg={srsConfig} onGrade={gradeSrs} />;
    }
    return <CramButtons onMark={mode === "learn" ? markLearn : markCram} />;
  }

  return (
    <Layout>
      {/* One compact line: back · what you're studying · progress · settings */}
      <div className="mb-4 flex items-center gap-3">
        <BackLink deckId={deckId} navigate={navigate} canGoBack={canGoBack} inline />
        {groupName && (
          <span
            className="hidden max-w-[16rem] truncate text-sm font-semibold text-slate-500 sm:inline"
            title={`${groupName} — ${deckIds.length} decks pooled`}
          >
            {groupName}
            <span className="font-normal text-slate-400"> · {deckIds.length} decks</span>
          </span>
        )}
        <div className="h-2 min-w-[6rem] flex-1 overflow-hidden rounded-full bg-slate-200">
          <div
            className={`h-full rounded-full transition-all ${
              studyMode === "anki" ? "bg-emerald-600" : "bg-red-600"
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span
          className="shrink-0 text-sm font-medium text-slate-500"
          title={`${total - queue.length} of ${total} cards cleared from today's queue${
            stats.answers > 0
              ? ` · ${stats.correct}/${stats.answers} answers correct`
              : ""
          }`}
        >
          {total - queue.length}/{total}
          {stats.answers > 0 && (
            <span className="ml-2 text-xs font-normal text-slate-400">
              {Math.round((stats.correct / stats.answers) * 100)}%
            </span>
          )}
        </span>
        {studyMode === "anki" && <SaveBadge status={saveStatus} />}
        {settingsButton}
      </div>



      {!current ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 py-20 text-center">
          <PartyPopper className="mx-auto mb-3 text-emerald-500" size={40} />
          <p className="mb-1 text-lg font-bold text-emerald-800">
            {studyMode === "anki"
              ? "All caught up for today!"
              : "You got through the whole deck!"}
          </p>
          <p className="mb-1 text-sm text-emerald-700">
            {total} card{total === 1 ? "" : "s"}{" "}
            {studyMode === "anki" ? "cleared" : "mastered"} this session.
          </p>
          {stats.answers > 0 && (
            <p className="mb-5 text-sm text-emerald-700">
              You answered <b>{stats.correct}</b> of <b>{stats.answers}</b>{" "}
              correctly —{" "}
              <b>{Math.round((stats.correct / stats.answers) * 100)}% accuracy</b>
              {stats.answers > total && (
                <span className="text-emerald-600/70">
                  {" "}
                  ({stats.answers - total} repeat
                  {stats.answers - total === 1 ? "" : "s"} along the way)
                </span>
              )}
              .
            </p>
          )}
          <div className="flex justify-center gap-3">
            {studyMode === "quizlet" && (
              <button
                onClick={restart}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                <RotateCcw size={14} /> Study again
              </button>
            )}
            <button
              onClick={() =>
                canGoBack ? navigate(-1) : navigate(deckId ? `/deck/${deckId}` : "/decks")
              }
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-white"
            >
              Done
            </button>
          </div>
        </div>
      ) : mode === "learn" && studyMode === "quizlet" && learnFormat === "mc" ? (
        /* ---------- Learn: multiple choice ---------- */
        <div className="mx-auto max-w-2xl">
          {current.kind === "text" ? (
            <div className="max-h-[46vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
              <RichText html={current.frontHtml} className="text-lg text-slate-900" />
            </div>
          ) : (
            <OcclusionCard item={current} occMode={occMode} revealed={mcPicked !== null} />
          )}
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {mcOptions.map((opt, i) => {
              const isAnswer = opt === answer;
              const picked = mcPicked === i;
              let cls = "border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50";
              if (mcPicked !== null) {
                if (isAnswer) cls = "border-emerald-400 bg-emerald-50 text-emerald-800";
                else if (picked) cls = "border-red-400 bg-red-50 text-red-700";
                else cls = "border-slate-200 bg-white opacity-60";
              }
              return (
                <button
                  key={i}
                  disabled={mcPicked !== null}
                  onClick={() => {
                    captureGuessTime();
                    setMcPicked(i);
                    setChecked(isAnswer);
                  }}
                  className={`rounded-xl border p-3 text-left text-sm transition ${cls}`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {mcPicked !== null && (
            <div className="mt-4 text-center">
              <button
                onClick={() => markLearn(checked === true)}
                className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Continue
              </button>
            </div>
          )}
        </div>
      ) : mode === "learn" && studyMode === "quizlet" && learnFormat === "written" ? (
        /* ---------- Learn: written ---------- */
        <div className="mx-auto max-w-2xl">
          {current.kind === "text" ? (
            <div className="max-h-[46vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
              <RichText html={current.frontHtml} className="text-lg text-slate-900" />
            </div>
          ) : (
            <OcclusionCard item={current} occMode={occMode} revealed={checked !== null} />
          )}
          <div className="mt-4 flex gap-2">
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && checked === null && handleCheck()}
              disabled={checked !== null}
              placeholder="Type your answer…"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
            />
            {checked === null && (
              <button
                onClick={handleCheck}
                className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Check
              </button>
            )}
          </div>
          {checked !== null && (
            <div
              className={`mt-4 rounded-xl border p-4 text-sm ${
                checked ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
              }`}
            >
              <p className={`mb-1 font-semibold ${checked ? "text-emerald-700" : "text-red-700"}`}>
                {checked ? "Correct!" : "Not quite"}
              </p>
              <p className="text-slate-700">
                Answer: <b>{answer}</b>
              </p>
              {!checked && quizletSettings.retypeCorrect && (
                <input
                  autoFocus
                  value={retyped}
                  onChange={(e) => setRetyped(e.target.value)}
                  placeholder="Retype the correct answer to continue…"
                  className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
              )}
              <div className="mt-3 flex justify-end gap-2">
                {!checked && (
                  <button
                    onClick={() => markLearn(true)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    I actually had it right
                  </button>
                )}
                <button
                  onClick={() => markLearn(checked === true)}
                  disabled={!checked && !retypeSatisfied}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  Continue
                </button>
              </div>
            </div>
          )}
        </div>
      ) : current.kind === "occlusion" && (mode === "flip" || mode === "learn" || !current.unit.label) ? (
        /* ---------- occlusion flashcard ---------- */
        <div onClick={() => !flipped && (captureGuessTime(), setFlipped(true))}>
          <OcclusionCard item={current} occMode={occMode} revealed={flipped} />
        </div>
      ) : mode === "flip" || mode === "learn" ? (
        /* ---------- text flashcard ---------- */
        <div>
          <div className="flip-card mx-auto h-[min(64vh,36rem)] max-w-3xl">
            <div
              className={`flip-card-inner h-full w-full cursor-pointer ${flipped ? "flipped" : ""}`}
              onClick={() => {
                captureGuessTime();
                setFlipped((f) => !f);
              }}
            >
              <div className="flip-card-face overflow-y-auto rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                <div className="flex min-h-full">
                  <RichText
                    html={current.kind === "text" ? current.frontHtml : ""}
                    className="m-auto max-w-full text-center text-xl leading-relaxed text-slate-900"
                  />
                </div>
              </div>
              <div className="flip-card-face flip-card-back overflow-y-auto rounded-2xl border border-indigo-200 bg-indigo-50 p-8 shadow-sm">
                <div className="flex min-h-full">
                  <RichText
                    html={current.kind === "text" ? current.backHtml : ""}
                    className="m-auto max-w-full text-center text-xl leading-relaxed text-slate-900"
                  />
                </div>
              </div>
            </div>
          </div>

        </div>
      ) : (
        /* ---------- type the answer ---------- */
        <div className="mx-auto max-w-2xl">
          {current.kind === "text" ? (
            <div className="max-h-[52vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm">
              <RichText html={current.frontHtml} className="text-lg text-slate-900" />
            </div>
          ) : (
            <OcclusionCard item={current} occMode={occMode} revealed={checked !== null} />
          )}
          <div className="mt-4 flex gap-2">
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && checked === null && handleCheck()}
              disabled={checked !== null}
              placeholder={
                current.kind === "occlusion"
                  ? "Type what's under the amber mask…"
                  : "Type your answer…"
              }
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
            />
            {checked === null && (
              <button
                onClick={handleCheck}
                className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Check
              </button>
            )}
          </div>

          {checked !== null && (
            <div
              className={`mt-4 rounded-xl border p-4 text-sm ${
                checked ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
              }`}
            >
              <p className={`mb-1 font-semibold ${checked ? "text-emerald-700" : "text-red-700"}`}>
                {checked ? "Correct!" : "Not quite"}
              </p>
              {current.kind === "text" ? (
                <RichText
                  html={current.backHtml}
                  className="max-h-72 overflow-y-auto text-slate-700"
                />
              ) : (
                <p className="text-slate-700">
                  Answer: <b>{current.unit.label}</b>
                </p>
              )}
              {studyMode === "quizlet" && !checked && (
                <button
                  onClick={() => markCram(true)}
                  className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  I actually had it right
                </button>
              )}
              <AnswerButtons />
            </div>
          )}
        </div>
      )}

      {studyMode === "quizlet" && current && mode !== "learn" && (
        <p className="mt-6 text-center text-xs text-slate-400">
          Smart shuffle: misses come back within a few cards, slow answers
          return near the end, fast answers leave the session. Your Anki-mode
          schedule is untouched.
        </p>
      )}
      {studyMode === "quizlet" && current && mode === "learn" && (
        <p className="mt-6 text-center text-xs text-slate-400">
          Learn: multiple choice until you get a card right, then written.
          Two correct answers = mastered. Misses reset a card to not-learned.
        </p>
      )}


      {/* Sticky action bar — always reachable without scrolling */}
      {current && (
        <>
          {/* spacer so the card never hides behind the fixed bar */}
          <div className="h-32" aria-hidden />
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 shadow-[0_-2px_12px_rgba(15,23,42,0.06)] backdrop-blur">
            <div className="mx-auto max-w-3xl px-4 py-2">
              {isFlashcardContext && (
                <>
                  {!flipped ? (
                    <div className="flex justify-center">
                      <button
                        onClick={() => {
                          captureGuessTime();
                          setFlipped(true);
                        }}
                        className="rounded-xl bg-indigo-600 px-10 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
                      >
                        Show answer <span className="text-[10px] opacity-60">(Space)</span>
                      </button>
                    </div>
                  ) : (
                    <AnswerButtons />
                  )}
                </>
              )}

              <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 border-t border-slate-100 pt-2 text-sm">
            <div className="relative">
              <button
                onClick={() => setFormatOpen((o) => !o)}
                className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                title="Change how cards are asked"
              >
                {FORMAT_LABELS[mode]} <ChevronDown size={12} />
              </button>
              {formatOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setFormatOpen(false)} />
                  <div className="absolute bottom-8 left-0 z-30 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                    {(["flip", "type", ...(studyMode === "quizlet" ? ["learn" as const] : [])] as const).map(
                      (m) => (
                        <button
                          key={m}
                          onClick={() => {
                            setMode(m);
                            resetCardUI();
                            setFormatOpen(false);
                          }}
                          className={`block w-full px-3 py-1.5 text-left text-sm transition hover:bg-slate-50 ${
                            mode === m ? "font-semibold text-indigo-600" : "text-slate-700"
                          }`}
                        >
                          {FORMAT_LABELS[m]}
                        </button>
                      )
                    )}
                  </div>
                </>
              )}
            </div>
            {showMaskToggle && (
              <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs font-medium">
                {(["hideOne", "hideAll"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setOccMode(m)}
                    className={`px-2.5 py-1 transition ${
                      occMode === m
                        ? "bg-slate-800 text-white"
                        : "bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {m === "hideOne" ? "Hide one" : "Hide all"}
                  </button>
                ))}
              </div>
            )}
          {studyMode === "anki" && current && (
            <>
              {currentSrs?.flag && (
                <Flag
                  size={14}
                  fill="currentColor"
                  className={
                    {
                      red: "text-red-500",
                      orange: "text-orange-500",
                      green: "text-emerald-500",
                      blue: "text-sky-500",
                    }[currentSrs!.flag!]
                  }
                />
              )}
              {currentSrs?.marked && (
                <Star size={14} fill="currentColor" className="text-amber-400" />
              )}
              <button
                onClick={() => {
                  if (current.kind === "text") setShowEdit(true);
                  else navigate(`/deck/${current.deckId}/occlusion/${current.sheet.id}/edit`);
                }}
                className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <Pencil size={12} /> Edit
              </button>
              <div className="relative">
                <button
                  onClick={() => setMoreOpen((o) => !o)}
                  className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  More <ChevronDown size={12} />
                </button>
                {moreOpen && (
                  <div
                    className="absolute bottom-9 left-1/2 z-30 max-h-[60vh] w-52 -translate-x-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 text-left shadow-xl"
                    onClick={() => setMoreOpen(false)}
                  >
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="text-xs text-slate-400">Flag:</span>
                      {(["red", "orange", "green", "blue"] as FlagColor[]).map((c) => (
                        <button
                          key={c}
                          onClick={() => actions.flag(c)}
                          className={`h-4 w-4 rounded-full ${
                            { red: "bg-red-500", orange: "bg-orange-500", green: "bg-emerald-500", blue: "bg-sky-500" }[c]
                          } ${currentSrs?.flag === c ? "ring-2 ring-slate-700 ring-offset-1" : ""}`}
                        />
                      ))}
                      <button
                        onClick={() => actions.flag(null)}
                        className="text-[10px] text-slate-400 hover:text-slate-600"
                      >
                        clear
                      </button>
                    </div>
                    <MoreItem onClick={actions.buryCard}>Bury Card</MoreItem>
                    <MoreItem onClick={actions.resetCard}>Reset Card…</MoreItem>
                    <MoreItem onClick={actions.setDueDate}>Set Due Date…</MoreItem>
                    <MoreItem onClick={actions.suspendCard}>Suspend Card</MoreItem>
                    <MoreItem onClick={actions.cardInfo}>Card Info</MoreItem>
                    <MoreItem onClick={actions.previousCard}>Previous Card</MoreItem>
                    <div className="my-1 border-t border-slate-100" />
                    <MoreItem onClick={actions.markNote}>
                      {currentSrs?.marked ? "Unmark Note" : "Mark Note"}
                    </MoreItem>
                    <MoreItem onClick={actions.buryNote}>Bury Note</MoreItem>
                    <MoreItem onClick={actions.suspendNote}>Suspend Note</MoreItem>
                    <MoreItem onClick={actions.createCopy}>Create Copy…</MoreItem>
                    <MoreItem danger onClick={actions.deleteNote}>Delete Note</MoreItem>
                  </div>
                )}
              </div>
            </>
          )}
              </div>
            </div>
          </div>
        </>
      )}

      {showSettings && (
        <StudySettingsModal
          studyMode={studyMode}
          anki={ankiSettings}
          quizlet={quizletSettings}
          onChange={(a, q) => {
            setAnkiSettings(a);
            setQuizletSettings(q);
            restart();
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showEdit && current?.kind === "text" && (
        <CardEditorModal
          initial={cards.find((c) => c.deckId === current.deckId && c.id === current.cardId)}
          uid={user?.uid}
          deckId={current.deckId}
          onSave={async (data) => {
            if (user) await updateCard(user.uid, current.deckId, current.cardId, data);
            await reloadData();
            restart();
          }}
          onClose={() => setShowEdit(false)}
        />
      )}
    </Layout>
  );
}

/** Tells you whether graded cards have actually reached the server. */
function SaveBadge({ status }: { status: SaveStatus }) {
  if (status === "saved") {
    return (
      <span
        className="hidden items-center gap-1 text-xs font-medium text-emerald-600 sm:flex"
        title="Every answer so far is saved."
      >
        <Check size={13} /> Saved
      </span>
    );
  }
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-slate-400">
        <Loader2 size={13} className="animate-spin" /> Saving
      </span>
    );
  }
  if (status === "offline") {
    return (
      <span
        className="flex items-center gap-1 text-xs font-medium text-amber-600"
        title="You're offline. Your answers are stored on this device and sync automatically when you reconnect."
      >
        <CloudOff size={13} /> Offline
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1 text-xs font-medium text-red-600"
      title="Some answers couldn't be saved. Keep this tab open — retrying automatically."
    >
      <AlertTriangle size={13} /> Retrying
    </span>
  );
}

/**
 * Returns to wherever the session was started from — the Anki page, the
 * Quizlet page, a deck, the home overview. Falls back to a sensible page when
 * the study screen was opened directly (a bookmark or a fresh tab).
 */
function BackLink({
  deckId,
  navigate,
  canGoBack,
  inline,
}: {
  deckId?: string;
  navigate: ReturnType<typeof useNavigate>;
  canGoBack: boolean;
  inline?: boolean;
}) {
  return (
    <button
      onClick={() =>
        canGoBack ? navigate(-1) : navigate(deckId ? `/deck/${deckId}` : "/decks")
      }
      className={`flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 ${
        inline ? "" : "mb-4"
      }`}
    >
      <ArrowLeft size={15} /> Back
    </button>
  );
}

function MoreItem({
  danger,
  onClick,
  children,
}: {
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full px-3 py-1.5 text-left text-sm transition ${
        danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

