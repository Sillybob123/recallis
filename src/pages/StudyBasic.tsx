import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CalendarClock,
  Check,
  ChevronDown,
  CloudOff,
  Flag,
  Gamepad2,
  HelpCircle,
  Loader2,
  PartyPopper,
  Pencil,
  RotateCcw,
  Settings,
  Sparkles,
  Star,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useStudyMode } from "../contexts/StudyModeContext";
import { Layout } from "../components/Layout";
import { RichText } from "../components/RichText";
import { ShapeOverlay } from "../components/ShapeOverlay";
import { ZoomPan } from "../components/ZoomPan";
import { searchReference } from "../lib/anatomyReference";
import { StudySettingsModal } from "../components/StudySettingsModal";
import { RemoteSetup } from "../components/RemoteSetup";
import { occlusionVisibility } from "../lib/shapes";
import { actionForKey, type RemoteAction } from "../lib/remote";
import { useGamepadRemote } from "../lib/useRemote";
import {
  createCard,
  deleteCard,
  deleteOcclusionSheet,
  deleteSrsState,
  logReview,
  recordCardResult,
  setItemStarred,
  setItemTags,
  updateCard,
} from "../lib/firestore";
import { CardEditorModal } from "../components/CardEditorModal";
import { Confetti } from "../components/Confetti";
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
  loadRemoteMapping,
  saveQuizletSettings,
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
  clearTroubleList,
  flushCramSession,
  loadCramSession,
  loadTroubleList,
  saveCramSession,
  saveTroubleList,
  STILL_LEARNING_MISSES,
} from "../lib/cramSession";

/**
 * Base allowance for recognising a card, before reading time. A flat
 * threshold punished long cards: seven seconds is quick for a two-line cloze
 * and slow for three words, so a first-try answer on anything wordy never
 * counted as fast and the card came back for no reason.
 */
const FAST_ANSWER_BASE_MS = 9000;
/** However long the card, past this you were working it out. */
const FAST_ANSWER_CAP_MS = 28000;
/**
 * Reading speed used to scale the allowance. Deliberately below prose pace:
 * these cards are dense terminology, not sentences you skim.
 */
const READING_WPM = 160;

/** How quick counts as "knew it straight away" for this particular card. */
function fastThresholdMs(item: StudyItem): number {
  const text =
    item.kind === "text" ? item.frontPlain : item.unit.label ?? "";
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(
    FAST_ANSWER_CAP_MS,
    FAST_ANSWER_BASE_MS + (words / READING_WPM) * 60000
  );
}
/** Anki's grading keys, which its users already have in their fingers. */
const ANKI_GRADE_KEYS: Record<string, Rating> = {
  "1": "again",
  "2": "hard",
  "3": "good",
  "4": "easy",
};

/** Correct answers a Quizlet card needs before it leaves the session. */
const MASTERY = 2;
/**
 * A correct answer this long after you last saw the card is retrieval from
 * memory rather than an echo of the answer you were just shown.
 */
const SPACED_RECALL_MS = 2 * 60 * 1000;
/** …or this many other cards in between, for someone answering quickly. */
const SPACED_RECALL_CARDS = 10;
/**
 * However cramped the session, never demand more than this. Past it you are
 * drilling a card you have already recalled correctly several times.
 */
const MAX_CORRECT_ANSWERS = 3;
/** Below this, the queue simply cannot space anything out. */
const SHORT_QUEUE = 6;
/** Where a just-missed card goes back: soon, while the answer is fresh. */
const RETRY_GAP = 3;
/**
 * Where a card you'd previously missed goes after you finally get it right.
 * A dozen cards is a couple of minutes at a normal pace — long enough that
 * answering it is recall rather than an echo of the card you just read.
 */
const SPACED_GAP = 12;
/**
 * How long an answer holds the card shut afterwards. Short enough to be
 * invisible when you're deliberately answering, long enough to swallow a
 * stuck key or a double-clicked button.
 */
const ANSWER_LOCK_MS = 300;

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
  const {
    hidden: hiddenIds,
    target: targetIds,
    outline: outlineIds,
  } = occlusionVisibility(item.sheet.shapes, item.unit.shapeIds, occMode, revealed);
  return (
    <div>
      <ZoomPan
        resetKey={item.key}
        className="mx-auto w-full max-w-3xl rounded-xl border border-slate-200 bg-white"
      >
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
      </ZoomPan>
      {item.unit.label && revealed && (
        <p className="mt-3 text-center text-lg font-semibold text-slate-900">
          {item.unit.label}
        </p>
      )}
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="mr-1 rounded border border-slate-200 bg-slate-50 px-1 font-sans text-[10px] font-semibold text-slate-500">
      {children}
    </kbd>
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
            {d.hint && (
              <span className="ml-1 hidden text-[10px] opacity-50 sm:inline">({d.hint})</span>
            )}
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
  // Deck order depends on how you got here, but it's the same session either
  // way, so the scope is sorted.
  // Reviewing the hard cards is a separate run under its own key, so starting
  // one doesn't disturb the full pass you may be part-way through.
  const [reviewOnly, setReviewOnly] = useState(false);
  const [troubleKeys, setTroubleKeys] = useState<string[]>([]);
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
  const [remoteMapping, setRemoteMapping] = useState(loadRemoteMapping);
  const [showRemote, setShowRemote] = useState(false);

  // Ordered runs are their own session, so switching between the two keeps
  // both. Shuffle stays on the original key so existing sessions survive.
  const orderKey = quizletSettings.studyOrder === "ordered" ? ":ordered" : "";
  const baseScope = `${[...deckIds].sort().join(",")}:${
    cardsOnly ? "cards" : "all"
  }${orderKey}`;
  const cramScope = reviewOnly ? `${baseScope}:review` : baseScope;
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
  // null = follow whatever the sheet was made with; setting it overrides for
  // this session only, which is what the toggle in the bar is for.
  const [occOverride, setOccOverride] = useState<"hideOne" | "hideAll" | null>(
    null
  );
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState<null | boolean>(null);
  const [mcPicked, setMcPicked] = useState<number | null>(null);
  const [retyped, setRetyped] = useState("");
  const [sessionNonce, setSessionNonce] = useState(0);
  const [formatOpen, setFormatOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [gradingOpen, setGradingOpen] = useState(false);
  const [rootsOpen, setRootsOpen] = useState(false);
  const [rootQuery, setRootQuery] = useState("");
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
  const missesRef = useRef<Map<string, number>>(new Map());
  /** when each card was last answered, for judging spaced recall */
  const lastSeenRef = useRef<Map<string, { at: number; n: number }>>(new Map());
  const answerCountRef = useRef(0);
  const answerLockRef = useRef(false);
  /** every item this scope can study, for sizing the extra-review pool */
  const allItemsRef = useRef<StudyItem[]>([]);
  /** set when a rebuild must keep the session (an edit, a settings change) */
  const preserveRef = useRef(false);
  const [celebrate, setCelebrate] = useState(false);
  const celebratedRef = useRef(false);
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
    // Rebuilding after an edit is the same session, so its tally stands.
    if (preserveRef.current) preserveRef.current = false;
    else setStats({ answers: 0, correct: 0, wrong: 0 });
    const all = [
      ...buildTextItems(cards, {
        answerWithTerm:
          studyMode === "quizlet" && quizletSettings.answerWith === "term",
      }),
      ...(cardsOnly ? [] : buildOcclusionItems(sheets)),
    ];
    strengthRef.current = new Map();
    missesRef.current = new Map();
    lastSeenRef.current = new Map();
    answerCountRef.current = 0;

    if (studyMode === "quizlet") {
      let cancelled = false;
      (async () => {
        // Resume an unfinished cram run rather than reshuffling from scratch —
        // from this device, or from wherever it was last touched.
        const [saved, trouble] = await Promise.all([
          loadCramSession(user?.uid ?? null, cramScope),
          loadTroubleList(user?.uid ?? null, baseScope),
        ]);
        if (cancelled) return;
        setTroubleKeys(trouble);
        const troubleSet = new Set(trouble);
        // Extra review = what kept beating you, plus whatever you starred.
        const starredCards = new Set(cards.filter((c) => c.starred).map((c) => c.id));
        const starredSheets = new Set(
          sheets.filter((sh) => sh.starred).map((sh) => sh.id)
        );
        const wantsReview = (it: StudyItem) =>
          troubleSet.has(it.key) ||
          (it.kind === "text"
            ? starredCards.has(it.cardId)
            : starredSheets.has(it.sheet.id));
        allItemsRef.current = all;
        let pool = all;
        if (reviewOnly) {
          pool = all.filter(wantsReview);
          // Those cards can have been edited or deleted since. Rather than
          // strand the session on an empty deck, forget the stale list.
          if (pool.length === 0) {
            clearTroubleList(user?.uid ?? null, baseScope);
            setTroubleKeys([]);
            setReviewOnly(false);
            pool = all;
          }
        }
        if (saved) {
          const byKey = new Map(pool.map((it) => [combinedKey(it), it]));
          const restored = saved.order
            .map((k) => byKey.get(k))
            .filter((it): it is StudyItem => Boolean(it));
          if (restored.length > 0) {
            strengthRef.current = new Map(saved.strengths);
            missesRef.current = new Map(saved.misses ?? []);
            setQueue(restored);
            setTotal(Math.max(saved.total, restored.length));
            setNextDueMs(null);
            setQueueReady(true);
            return;
          }
          clearCramSession(user?.uid ?? null, cramScope);
        }
        // In order, a deck built from a lecture runs slide 1 to slide 2, and
        // the cloze deletions of one sentence stay together — which is the
        // whole point, so sibling spreading is skipped rather than fighting it.
        const items =
          quizletSettings.studyOrder === "ordered"
            ? [...pool].sort((a, b) => itemOrder(a) - itemOrder(b))
            : spreadSiblings(shuffle(pool), ankiSettings.siblingGap);
        setQueue(items);
        setTotal(items.length);
        setNextDueMs(null);
        setQueueReady(true);
      })();
      return () => {
        cancelled = true;
      };
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
    reviewOnly,
    quizletSettings.answerWith,
    quizletSettings.studyOrder,
  ]);

  // Finishing the deck is the one moment worth marking.
  useEffect(() => {
    if (studyMode !== "quizlet" || !queueReady || total === 0) return;
    if (queue.length > 0) {
      celebratedRef.current = false;
      return;
    }
    if (!celebratedRef.current) {
      celebratedRef.current = true;
      setCelebrate(true);
    }
  }, [queue.length, queueReady, studyMode, total]);

  // Leaving mid-deck must not lose the last few answers.
  useEffect(() => () => void flushCramSession(), []);

  const current = queue[0];
  const showMaskToggle = current?.kind === "occlusion";
  const occMode: "hideOne" | "hideAll" =
    occOverride ??
    (current?.kind === "occlusion"
      ? (current.sheet.revealMode ?? "hideAll")
      : "hideAll");
  const anatomy = studyMode === "quizlet" && quizletSettings.anatomyMode;

  /**
   * Where an item sits in "in order" mode. Cards made from a lecture are
   * created slide by slide, so creation time is slide order; occlusion masks
   * fall in with the sheet they belong to.
   */
  const createdAtOf = useMemo(() => {
    const byCard = new Map<string, number>();
    for (const c of cards ?? []) byCard.set(`${c.deckId}|${c.id}`, c.createdAt);
    for (const sh of sheets ?? []) byCard.set(`${sh.deckId}|${sh.id}`, sh.createdAt);
    return byCard;
  }, [cards, sheets]);
  const itemOrder = useCallback(
    (item: StudyItem) =>
      createdAtOf.get(
        item.kind === "text"
          ? `${item.deckId}|${item.cardId}`
          : `${item.deckId}|${item.sheet.id}`
      ) ?? 0,
    [createdAtOf]
  );

  /**
   * What's left to do, split the way Anki splits it. Counting the queue
   * rather than the deck means it falls as you work, including the card on
   * screen — which is what makes it worth watching.
   */
  const ankiCounts = useMemo(() => {
    if (studyMode !== "anki" || !srsMap) return null;
    let fresh = 0;
    let learning = 0;
    let due = 0;
    for (const item of queue) {
      const state = srsMap.get(combinedKey(item));
      if (!state || isNew(state)) fresh++;
      else if (state.phase === "review") due++;
      else learning++;
    }
    return { fresh, learning, due };
  }, [queue, srsMap, studyMode]);
  const rootMatches = useMemo(() => searchReference(rootQuery), [rootQuery]);

  // Stars live on the note, so they're read straight off the loaded cards
  // rather than tracked per session.
  const starredCardIds = useMemo(
    () => new Set((cards ?? []).filter((c) => c.starred).map((c) => c.id)),
    [cards]
  );
  const starredSheetIds = useMemo(
    () => new Set((sheets ?? []).filter((sh) => sh.starred).map((sh) => sh.id)),
    [sheets]
  );
  const isStarred = useCallback(
    (item: StudyItem) =>
      item.kind === "text"
        ? starredCardIds.has(item.cardId)
        : starredSheetIds.has(item.sheet.id),
    [starredCardIds, starredSheetIds]
  );

  // Recomputed as you star things mid-session, so the offer to review is
  // always current.
  const reviewCount = useMemo(() => {
    const troubleSet = new Set(troubleKeys);
    return allItemsRef.current.filter(
      (it) => troubleSet.has(it.key) || isStarred(it)
    ).length;
  }, [troubleKeys, isStarred]);

  /** Stars the note behind the card on screen, for extra review later. */
  function toggleStar() {
    if (!current || !user) return;
    const next = !isStarred(current);
    if (current.kind === "text") {
      setCards((prev) =>
        (prev ?? []).map((c) =>
          c.id === current.cardId ? { ...c, starred: next } : c
        )
      );
      setItemStarred(user.uid, current.deckId, "card", current.cardId, next).catch(
        () => {}
      );
    } else {
      const sheetId = current.sheet.id;
      setSheets((prev) =>
        (prev ?? []).map((sh) => (sh.id === sheetId ? { ...sh, starred: next } : sh))
      );
      setItemStarred(user.uid, current.deckId, "sheet", sheetId, next).catch(
        () => {}
      );
    }
  }

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

  /** Opens the right editor for the card on screen (E, or the toolbar). */
  function openEditor() {
    if (!current) return;
    if (current.kind === "text") setShowEdit(true);
    else navigate(`/deck/${current.deckId}/occlusion/${current.sheet.id}/edit`);
  }

  /**
   * Two answers can land before React has drawn the next card — a fast double
   * press, or a double-clicked button — and the second would silently grade a
   * card nobody saw. The first one through wins.
   */
  function claimAnswer(): boolean {
    if (answerLockRef.current) return false;
    answerLockRef.current = true;
    window.setTimeout(() => {
      answerLockRef.current = false;
    }, ANSWER_LOCK_MS);
    return true;
  }

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
    // Studying in order means the cloze deletions of one sentence belong
    // together; pushing them apart is exactly what you asked it not to do.
    if (studyMode === "quizlet" && quizletSettings.studyOrder === "ordered") {
      return nextQueue;
    }
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
      // Finished. Which cards fought back is worth keeping — it's the whole
      // basis for the next sitting — even though the run itself is not.
      const stillLearning = [...missesRef.current.entries()]
        .filter(([, misses]) => misses >= STILL_LEARNING_MISSES)
        .map(([key]) => key);
      saveTroubleList(user?.uid ?? null, baseScope, stillLearning);
      setTroubleKeys(stillLearning);
      clearCramSession(user?.uid ?? null, cramScope);
    } else {
      saveCramSession(user?.uid ?? null, cramScope, {
        order: next.map(combinedKey),
        strengths: [...strengthRef.current.entries()],
        misses: [...missesRef.current.entries()],
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

  /**
   * Whether this answer is a genuine re-test rather than a repeat of one you
   * just did. Quizlet's Learn works the same way: it models the gap since the
   * previous answer instead of counting correct answers, because a correct
   * answer moments after being shown the answer proves very little, and one
   * given minutes later proves a lot.
   */
  function isSpacedRecall(key: string, strength: number): boolean {
    const last = lastSeenRef.current.get(key);
    // No record but existing credit means the session was resumed — whatever
    // else is true, real time has passed.
    if (!last) return strength > 0;
    if (queue.length <= SHORT_QUEUE) return true;
    return (
      Date.now() - last.at >= SPACED_RECALL_MS ||
      answerCountRef.current - last.n >= SPACED_RECALL_CARDS
    );
  }

  function markSeen(key: string) {
    answerCountRef.current += 1;
    lastSeenRef.current.set(key, { at: Date.now(), n: answerCountRef.current });
  }

  function recordMiss(key: string) {
    missesRef.current.set(key, (missesRef.current.get(key) ?? 0) + 1);
    strengthRef.current.set(key, 0);
  }

  /**
   * Whether a correct answer finishes the card off. Two correct answers with
   * a real gap between them is the evidence we want; a third is only asked for
   * when the gaps never materialised.
   */
  function retiresNow(strength: number, spaced: boolean): boolean {
    if (strength < MASTERY) return false;
    return spaced || strength >= MAX_CORRECT_ANSWERS;
  }

  /** Quizlet flashcards mode: adaptive by speed + accuracy. */
  function markCram(correct: boolean) {
    if (!current || !claimAnswer()) return;
    pushHistory();
    recordStats(current, correct);
    recordAnswer(correct);
    const key = current.key;
    const st = strengthRef.current.get(key) ?? 0;
    const missed = (missesRef.current.get(key) ?? 0) > 0;
    const spaced = isSpacedRecall(key, st);
    markSeen(key);
    let nextQueue: StudyItem[];
    if (!correct) {
      recordMiss(key);
      nextQueue = reinsert(queue, current, RETRY_GAP);
    } else {
      // Answered right first time and promptly: a card you already know.
      const knewIt =
        !missed &&
        st === 0 &&
        guessMsRef.current > 0 &&
        guessMsRef.current < fastThresholdMs(current);
      const strength = st + 1;
      strengthRef.current.set(key, strength);
      nextQueue =
        knewIt || retiresNow(strength, spaced)
          ? queue.slice(1)
          : reinsert(
              queue,
              current,
              missed
                ? Math.max(SPACED_GAP, queue.length - 2)
                : Math.max(8, queue.length - 2)
            );
    }
    commitCramQueue(applySiblingPolicy(nextQueue, current), total);
    resetCardUI();
  }

  /** Quizlet Learn mode: not-learned → familiar (1 correct) → mastered (2). */
  function markLearn(correct: boolean) {
    if (!current || !claimAnswer()) return;
    pushHistory();
    recordStats(current, correct);
    recordAnswer(correct);
    const key = current.key;
    const st = strengthRef.current.get(key) ?? 0;
    const missed = (missesRef.current.get(key) ?? 0) > 0;
    const spaced = isSpacedRecall(key, st);
    markSeen(key);
    let nextQueue: StudyItem[];
    if (!correct) {
      recordMiss(key);
      nextQueue = reinsert(queue, current, RETRY_GAP);
    } else {
      const strength = st + 1;
      strengthRef.current.set(key, strength);
      nextQueue = retiresNow(strength, spaced)
        ? queue.slice(1)
        : reinsert(
            queue,
            current,
            missed
              ? Math.max(SPACED_GAP, Math.floor(queue.length / 2))
              : Math.min(6, queue.length)
          );
    }
    commitCramQueue(applySiblingPolicy(nextQueue, current), total);
    resetCardUI();
  }

  /** Anki mode: grade → SM-2 schedule persisted; learning steps stay in session. */
  function gradeSrs(rating: Rating) {
    if (!current || !user || !claimAnswer()) return;
    const prev = srsMap?.get(combinedKey(current)) ?? null;
    pushHistory(current, prev);
    const durMs = Date.now() - shownAtRef.current;
    recordAnkiReview(durMs);
    const next = rate(prev, rating, Date.now(), srsConfig);
    // Append-only history, like Anki's revlog — drives Browse's Today filters
    // and future FSRS optimization. Losing one entry is tolerable, so it
    // doesn't go through the retrying writer.
    logReview(user.uid, current.deckId, {
      itemKey: current.key,
      rating,
      at: Date.now(),
      durMs: Math.min(durMs, 60000),
      phase: prev && prev.reps > 0 ? prev.phase : "new",
      firstReview: !prev || prev.reps === 0,
    }).catch(() => {});
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

  /**
   * Starts a run over. `review` picks the still-learning cards only; the full
   * pass keeps its own saved progress either way, so switching costs nothing.
   */
  function startSession(review: boolean) {
    clearCramSession(
      user?.uid ?? null,
      review ? `${baseScope}:review` : baseScope
    );
    setReviewOnly(review);
    setSessionNonce((n) => n + 1);
    resetCardUI();
  }

  /**
   * Rebuilds the queue against freshly loaded cards while keeping the run
   * going. Editing a card used to call restart(), which threw away every
   * card you'd already mastered.
   */
  function refreshQueue() {
    preserveRef.current = true;
    setSessionNonce((n) => n + 1);
    resetCardUI();
  }

  // ---------- Anki card actions (Edit / More menu) ----------
  const [moreOpen, setMoreOpen] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const historyRef = useRef<
    {
      queue: StudyItem[];
      deckId?: string;
      key?: string;
      prevSrs?: SrsState | null;
      /** the card that was answered, for rewinding Quizlet's counters */
      cramKey?: string;
      strength?: number;
      misses?: number;
      stats: { answers: number; correct: number; wrong: number };
    }[]
  >([]);

  function pushHistory(item?: StudyItem, prevSrs?: SrsState | null) {
    const cramKey = current?.key;
    historyRef.current.push({
      queue,
      deckId: item?.deckId,
      key: item?.key,
      prevSrs,
      // Captured separately from the SRS fields: undoing a Quizlet answer
      // must not touch the Anki schedule, and vice versa.
      cramKey,
      strength: cramKey ? strengthRef.current.get(cramKey) : undefined,
      misses: cramKey ? missesRef.current.get(cramKey) : undefined,
      stats,
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
      logReview(user!.uid, current.deckId, {
        itemKey: current.key,
        rating: "rescheduled",
        at: now,
        durMs: 0,
        phase: srsMap?.get(combinedKey(current))?.phase ?? "new",
        firstReview: false,
      }).catch(() => {});
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
      if (!last) return;
      // Put the card back exactly as it was: position in the queue, how well
      // it was known, how often it had been missed, and the session tally.
      if (last.cramKey) {
        const restore = (map: Map<string, number>, value: number | undefined) => {
          if (value === undefined) map.delete(last.cramKey!);
          else map.set(last.cramKey!, value);
        };
        restore(strengthRef.current, last.strength);
        restore(missesRef.current, last.misses);
      }
      setStats(last.stats);
      answerLockRef.current = false;
      if (studyMode === "quizlet") commitCramQueue(last.queue, total);
      else setQueue(last.queue);
      if (user && last.key !== undefined && last.deckId !== undefined) {
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
      // Holding a key fires it over and over; only the first press counts.
      if (e.repeat) return;
      const target = e.target as HTMLElement;
      // Rich-text fields are contenteditable, not <input>, so they need their
      // own check or typing "e" in the editor would reopen it.
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.closest("[role='dialog'], .fixed.inset-0")
      ) {
        return;
      }
      // Undo before the modifier guard below, since it needs Cmd/Ctrl.
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        actions.previousCard();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Escape closes whatever is open, and otherwise leaves the session.
      // Modals do their own thing, so it is left to them.
      if (e.key === "Escape" && !showEdit && !showSettings) {
        if (moreOpen || reviewOpen || gradingOpen || rootsOpen) {
          setMoreOpen(false);
          setReviewOpen(false);
          setGradingOpen(false);
          setRootsOpen(false);
          return;
        }
        e.preventDefault();
        if (canGoBack) navigate(-1);
        else navigate(deckId ? `/deck/${deckId}` : "/decks");
        return;
      }

      if (!current || showEdit || showSettings || moreOpen || showRemote) return;

      // The remote's own mapping comes first: a clicker sending PageDown, or
      // an 8BitDo sending the letter M, has to mean something here before
      // the letter shortcuts below get a look at it.
      const remoteAction = actionForKey(remoteMapping, e.key);
      if (remoteAction && isFlashcardContext) {
        // Grades only land once the answer is showing, exactly as in Anki,
        // so a pocketed remote can't grade a card you haven't read.
        const isGrade =
          remoteAction === "again" ||
          remoteAction === "hard" ||
          remoteAction === "good" ||
          remoteAction === "easy";
        if (!(isGrade && !flipped)) {
          e.preventDefault();
          runRemoteAction(remoteAction);
          return;
        }
      }

      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        openEditor();
        return;
      }

      // Anki review keys, matching Anki's own 1–4 grading. Bury/suspend/mark
      // use unambiguous letters rather than Anki's =/@/! which differ by
      // version and keyboard layout.
      if (studyMode === "anki") {
        const rating = ANKI_GRADE_KEYS[e.key];
        if (rating) {
          // Anki ignores the grade keys until the answer is showing, so that
          // a stray keypress can't grade a card you haven't read.
          if (!flipped) return;
          e.preventDefault();
          gradeSrs(rating);
          return;
        }
        if (e.key === "b" || e.key === "B") {
          e.preventDefault();
          actions.buryCard();
          return;
        }
        if (e.key === "s" || e.key === "S") {
          e.preventDefault();
          actions.suspendCard();
          return;
        }
        if (e.key === "m" || e.key === "M") {
          e.preventDefault();
          actions.markNote();
          return;
        }
        if (e.key === "z" || e.key === "Z") {
          e.preventDefault();
          actions.previousCard();
          return;
        }
      }

      if ((e.key === "s" || e.key === "S") && studyMode === "quizlet") {
        e.preventDefault();
        toggleStar();
        return;
      }
      if (!isFlashcardContext) return;
      if (e.key === " " || e.code === "Space" || e.key === "Enter") {
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

  /**
   * Everything a remote can do, in one place. The keyboard path and the
   * gamepad path both come through here, so a button and a key with the same
   * meaning can never drift apart.
   */
  const runRemoteAction = useCallback(
    (action: RemoteAction) => {
      if (!current || showEdit || showSettings) return;
      const grade = (rating: Rating) => {
        if (!flipped) return;
        if (studyMode === "anki") gradeSrs(rating);
        else if (mode === "learn") markLearn(rating !== "again");
        else markCram(rating !== "again");
      };
      switch (action) {
        case "advance":
          if (!flipped) {
            captureGuessTime();
            setFlipped(true);
          } else grade("good");
          return;
        case "fail":
          if (!flipped) {
            captureGuessTime();
            setFlipped(true);
          } else grade("again");
          return;
        case "again":
        case "hard":
        case "good":
        case "easy":
          grade(action);
          return;
        case "undo":
          actions.previousCard();
          return;
        case "star":
          toggleStar();
          return;
        case "scrollUp":
          window.scrollBy({ top: -220, behavior: "smooth" });
          return;
        case "scrollDown":
          window.scrollBy({ top: 220, behavior: "smooth" });
          return;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, flipped, studyMode, mode, showEdit, showSettings]
  );

  const gamepad = useGamepadRemote(
    remoteMapping,
    remoteMapping.gamepad && !showEdit && !showSettings && !showRemote,
    runRemoteAction
  );

  // Quizlet retires a card after MASTERY good answers, so the bar counts those
  // half-steps. Measuring the queue instead meant answering every card in the
  // deck correctly once still read 0% — the queue hadn't shrunk, because each
  // card had been put back for its second pass.
  const progress = (() => {
    if (total <= 0) return 0;
    if (studyMode !== "quizlet") {
      return Math.round(((total - queue.length) / total) * 100);
    }
    let earned = 0;
    for (const strength of strengthRef.current.values()) {
      earned += Math.min(strength, MASTERY);
    }
    return Math.min(100, Math.round((earned / (total * MASTERY)) * 100));
  })();

  if (!cards || !sheets || !srsMap || !queueReady) {
    return (
      <Layout>
        <div className="py-24 text-center text-slate-400">Loading…</div>
      </Layout>
    );
  }

  // Only shown once a controller has actually reported itself, so it reads
  // as confirmation that the remote is working rather than as clutter.
  const remoteButton = gamepad && (
    <button
      onClick={() => setShowRemote(true)}
      title={`${gamepad} — connected. Click to change what its buttons do.`}
      className="rounded-full border border-emerald-200 bg-emerald-50 p-1.5 text-emerald-600 transition hover:bg-emerald-100"
    >
      <Gamepad2 size={15} />
    </button>
  );

  const starButton = current && studyMode === "quizlet" && (
    <button
      onClick={toggleStar}
      title={
        isStarred(current)
          ? "Starred — it'll be in extra review (S)"
          : "Star this note for extra review (S)"
      }
      aria-pressed={isStarred(current)}
      className={`rounded-full border p-1.5 transition ${
        isStarred(current)
          ? "border-amber-300 bg-amber-50 text-amber-500"
          : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50"
      }`}
    >
      <Star size={14} fill={isStarred(current) ? "currentColor" : "none"} />
    </button>
  );

  /**
   * Extra review, as a header control rather than a slab under the card: a
   * count you can act on, with the two things you might want to do with it.
   */
  const reviewButton = studyMode === "quizlet" && reviewCount > 0 && (
    <div className="relative shrink-0">
      <button
        onClick={() => setReviewOpen((o) => !o)}
        title={`${reviewCount} card${
          reviewCount === 1 ? "" : "s"
        } set aside for extra review`}
        className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-semibold transition ${
          reviewOnly
            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
            : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
        }`}
      >
        <Sparkles size={12} />
        {reviewCount}
      </button>
      {reviewOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setReviewOpen(false)} />
          <div className="absolute right-0 top-9 z-30 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <p className="border-b border-slate-100 px-3 py-2 text-xs leading-snug text-slate-500">
              <b className="text-slate-700">{reviewCount} set aside</b> — cards
              you missed {STILL_LEARNING_MISSES}+ times, plus notes you starred.
            </p>
            <button
              onClick={() => {
                setReviewOpen(false);
                startSession(!reviewOnly);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
            >
              {reviewOnly ? "Study the whole deck" : "Study just those"}
            </button>
            {troubleKeys.length > 0 && (
              <button
                onClick={() => {
                  clearTroubleList(user?.uid ?? null, baseScope);
                  setTroubleKeys([]);
                  setReviewOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-slate-500 transition hover:bg-slate-50"
              >
                Clear misses
                <span className="block text-[11px] text-slate-400">
                  Starred notes stay starred
                </span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  /**
   * Look a word part up directly, for when the card doesn't happen to contain
   * the one you're wondering about.
   */
  const rootsButton = anatomy && (
    <div className="relative shrink-0">
      <button
        onClick={() => setRootsOpen((o) => !o)}
        title="Look up a Latin or Greek root"
        className={`rounded-full border p-1.5 transition ${
          rootsOpen
            ? "border-indigo-300 bg-indigo-50 text-indigo-600"
            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
        }`}
      >
        <BookOpen size={14} />
      </button>
      {rootsOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setRootsOpen(false)} />
          <div className="absolute right-0 top-9 z-30 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-100 p-2">
              <input
                autoFocus
                value={rootQuery}
                onChange={(e) => setRootQuery(e.target.value)}
                placeholder="cyto, -itis, kidney…"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
              />
            </div>
            <div className="max-h-72 overflow-y-auto">
              {rootQuery.trim() === "" ? (
                <p className="px-3 py-4 text-center text-xs text-slate-400">
                  Search by word part or by meaning — <b>nephr</b> or{" "}
                  <b>kidney</b> both find it.
                </p>
              ) : rootMatches.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-slate-400">
                  Nothing for “{rootQuery.trim()}”.
                </p>
              ) : (
                rootMatches.map((entry) => (
                  <div
                    key={entry.form}
                    className="border-b border-slate-50 px-3 py-2 last:border-b-0"
                  >
                    <p className="text-sm">
                      <span className="font-semibold text-slate-800">
                        {entry.form}
                      </span>
                      <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                        {entry.origin}
                      </span>
                    </p>
                    <p className="text-xs text-slate-600">{entry.meaning}</p>
                    {entry.example && (
                      <p className="mt-0.5 text-[11px] italic text-slate-400">
                        {entry.example}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );

  /** How this mode works and what the keys do, on demand. */
  const gradingButton = current && (
    <div className="relative shrink-0">
      <button
        onClick={() => setGradingOpen((o) => !o)}
        title="How this mode grades"
        className="rounded-full border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:bg-slate-50"
      >
        <HelpCircle size={14} />
      </button>
      {gradingOpen && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setGradingOpen(false)} />
          <div className="absolute right-0 top-9 z-30 w-72 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600 shadow-xl">
            {studyMode === "anki" ? (
              <>
                <p className="mb-2 font-semibold text-slate-800">Keyboard</p>
                <ul className="space-y-1">
                  <li>
                    <Kbd>Space</Kbd> show answer, then Good
                  </li>
                  <li>
                    <Kbd>1</Kbd>
                    <Kbd>2</Kbd>
                    <Kbd>3</Kbd>
                    <Kbd>4</Kbd> Again / Hard / Good / Easy
                  </li>
                  <li>
                    <Kbd>E</Kbd> edit this card
                  </li>
                  <li>
                    <Kbd>B</Kbd> bury until tomorrow
                  </li>
                  <li>
                    <Kbd>S</Kbd> suspend until you unsuspend it
                  </li>
                  <li>
                    <Kbd>M</Kbd> mark the note
                  </li>
                  <li>
                    <Kbd>Z</Kbd> or <Kbd>⌘Z</Kbd> undo the last answer
                  </li>
                  <li>
                    <Kbd>Esc</Kbd> back to the deck
                  </li>
                </ul>
                <p className="mt-2 border-t border-slate-100 pt-2 text-slate-400">
                  Grading uses FSRS-6. Bury hides a card until tomorrow;
                  suspend takes it out of reviews until you say otherwise.
                </p>
              </>
            ) : (
              <>
            <p className="mb-2 font-semibold text-slate-800">
              {mode === "learn" ? "Learn" : "Smart shuffle"}
            </p>
            {mode === "learn" ? (
              <p>
                Multiple choice until you get a card right, then written, so
                both formats get asked before a card is done.
              </p>
            ) : (
              <p>
                A quick first-try “Got it” retires a card outright; otherwise
                it comes back for a second go.
              </p>
            )}
            <p className="mt-2">
              A miss comes back within a few cards to fix the answer, then
              again much later. What retires it is getting it right{" "}
              <b>after a real gap</b> — a correct answer moments after seeing
              the answer doesn't count for much, so the second one has to be
              spaced.
            </p>
            <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
              <li>
                <Kbd>S</Kbd> star this note for extra review
              </li>
              <li>
                <Kbd>⌘Z</Kbd> undo the last answer
              </li>
            </ul>
            <p className="mt-2 border-t border-slate-100 pt-2 text-slate-400">
              Your Anki-mode schedule is untouched.
            </p>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );

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
              refreshQueue();
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
          Still learning <span className="hidden text-[10px] opacity-50 sm:inline">(X)</span>
        </button>
        <button
          onClick={() => onMark(true)}
          className="flex-1 rounded-xl border border-emerald-200 bg-emerald-50 py-3 text-sm font-semibold text-emerald-600 transition hover:bg-emerald-100"
        >
          Got it <span className="hidden text-[10px] opacity-50 sm:inline">(Space)</span>
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
      <div className="mb-4 flex items-center gap-2 sm:gap-3">
        <BackLink deckId={deckId} navigate={navigate} canGoBack={canGoBack} inline />
        {groupName && (
          <span
            className="hidden max-w-[16rem] truncate text-sm font-semibold text-slate-500 sm:inline"
            title={`${groupName} — ${deckIds.length} deck${
              deckIds.length === 1 ? "" : "s"
            } pooled`}
          >
            {groupName}
            <span className="font-normal text-slate-400">
              {" · "}
              {deckIds.length} deck{deckIds.length === 1 ? "" : "s"}
            </span>
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
          title={
            studyMode === "quizlet"
              ? `${total - queue.length} of ${total} cards fully mastered. The bar ` +
                `also counts cards you've got right once but not yet twice, so it ` +
                `runs ahead of this number.${
                  stats.answers > 0
                    ? ` ${stats.correct}/${stats.answers} answers correct.`
                    : ""
                }`
              : `${total - queue.length} of ${total} cards cleared from today's queue${
                  stats.answers > 0
                    ? ` · ${stats.correct}/${stats.answers} answers correct`
                    : ""
                }`
          }
        >
          {total - queue.length}/{total}
          {studyMode === "quizlet" && (
            <span className="hidden text-xs font-normal text-slate-400 sm:inline">
              {" mastered"}
            </span>
          )}
          {stats.answers > 0 && (
            <span className="hidden text-xs font-normal text-slate-400 sm:inline">
              {/* spaces inside the string, or "0/1" and "0%" read as "0/10%" */}
              {" · "}
              {Math.round((stats.correct / stats.answers) * 100)}% correct
            </span>
          )}
        </span>
        <span className="shrink-0">{studyMode === "anki" && <SaveBadge status={saveStatus} />}</span>
        {reviewButton}
        {remoteButton}
        {rootsButton}
        {starButton}
        {gradingButton}
        {settingsButton}
      </div>



      {!current ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 py-20 text-center">
          {celebrate && <Confetti onDone={() => setCelebrate(false)} />}
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
          {studyMode === "quizlet" && reviewCount > 0 && (
            <p className="mx-auto mb-5 max-w-md text-sm text-emerald-700">
              <b>{reviewCount}</b> card{reviewCount === 1 ? "" : "s"} set aside
              for extra review — the ones you missed {STILL_LEARNING_MISSES} or
              more times, plus anything you starred. Go again with just those,
              or reset and take the whole deck from the top.
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-3">
            {studyMode === "quizlet" && reviewCount > 0 && (
              <button
                onClick={() => startSession(true)}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                <Sparkles size={14} /> Extra review ({reviewCount})
              </button>
            )}
            {studyMode === "quizlet" && (
              <button
                onClick={() => startSession(false)}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold ${
                  reviewCount > 0
                    ? "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                }`}
              >
                <RotateCcw size={14} />{" "}
                {reviewCount > 0 ? "Reset progress — study all" : "Study again"}
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
              <RichText
                anatomy={anatomy}
                html={current.frontHtml}
                className="text-lg text-slate-900"
              />
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
                  className={`whitespace-pre-line rounded-xl border p-3 text-left text-sm transition ${cls}`}
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
              <RichText
                anatomy={anatomy}
                html={current.frontHtml}
                className="text-lg text-slate-900"
              />
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
                Answer: <b className="whitespace-pre-line">{answer}</b>
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
          {/*
            Keyed by the card: remounting stops the answer face from fading
            out over 0.12s while it already holds the *next* card's answer,
            which read as a foreign card flashing past. A freshly mounted
            element never animates from the previous card's state.
          */}
          <div className="flip-card mx-auto h-[min(64vh,36rem)] max-w-3xl">
            <div
              key={current.key}
              className={`flip-card-inner h-full w-full cursor-pointer ${flipped ? "flipped" : ""}`}
              onClick={() => {
                captureGuessTime();
                setFlipped((f) => !f);
              }}
            >
              <div className="flip-card-face overflow-y-auto rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                <div className="flex min-h-full">
                  <RichText
                    anatomy={anatomy}
                    html={current.kind === "text" ? current.frontHtml : ""}
                    className="m-auto max-w-full text-center text-xl leading-relaxed text-slate-900"
                  />
                </div>
              </div>
              <div className="flip-card-face flip-card-back overflow-y-auto rounded-2xl border border-indigo-200 bg-indigo-50 p-8 shadow-sm">
                <div className="flex min-h-full">
                  <RichText
                    anatomy={anatomy}
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
              <RichText
                anatomy={anatomy}
                html={current.frontHtml}
                className="text-lg text-slate-900"
              />
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
                    anatomy={anatomy}
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

      {current && (
        <>
          {/* spacer so the card never hides behind the fixed bar */}
          <div className="h-32" aria-hidden />
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 shadow-[0_-2px_12px_rgba(15,23,42,0.06)] backdrop-blur">
            {/* Anki puts the remaining counts here, under the card, and they
                are worth watching precisely because they move as you work. */}
            {ankiCounts && (
              <div className="flex items-center justify-center gap-3 pt-1.5 text-xs font-semibold tabular-nums">
                <span className="text-sky-500">
                  {ankiCounts.fresh}
                  <span className="ml-1 font-medium text-slate-400">new</span>
                </span>
                <span className="text-orange-500">
                  {ankiCounts.learning}
                  <span className="ml-1 font-medium text-slate-400">learning</span>
                </span>
                <span className="text-emerald-600">
                  {ankiCounts.due}
                  <span className="ml-1 font-medium text-slate-400">due</span>
                </span>
              </div>
            )}
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
                        Show answer <span className="hidden text-[10px] opacity-60 sm:inline">(Space)</span>
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
            {studyMode === "quizlet" && (
              <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs font-medium">
                {(
                  [
                    ["shuffle", "Shuffle"],
                    ["ordered", "In order"],
                  ] as ["shuffle" | "ordered", string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => {
                      if (quizletSettings.studyOrder === id) return;
                      const next = { ...quizletSettings, studyOrder: id };
                      setQuizletSettings(next);
                      saveQuizletSettings(next);
                    }}
                    title={
                      id === "ordered"
                        ? "Slide 1, then slide 2 — the order the cards were made in"
                        : "Random order"
                    }
                    className={`px-2.5 py-1 transition ${
                      quizletSettings.studyOrder === id
                        ? "bg-slate-800 text-white"
                        : "bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {showMaskToggle && (
              <div className="flex overflow-hidden rounded-lg border border-slate-300 text-xs font-medium">
                {(["hideOne", "hideAll"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setOccOverride(m)}
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
                onClick={openEditor}
                title="Edit this card (E)"
                className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <Pencil size={12} /> Edit <span className="hidden text-[10px] opacity-50 sm:inline">(E)</span>
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
                    <MoreItem onClick={() => setShowRemote(true)}>
                      Study remote…
                    </MoreItem>
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

      {showRemote && (
        <RemoteSetup
          mapping={remoteMapping}
          onChange={setRemoteMapping}
          onClose={() => setShowRemote(false)}
        />
      )}

      {showSettings && (
        <StudySettingsModal
          studyMode={studyMode}
          anki={ankiSettings}
          quizlet={quizletSettings}
          onChange={(a, q) => {
            setAnkiSettings(a);
            setQuizletSettings(q);
            // Settings change how cards are asked, not which ones you've
            // already got right, so the run survives this too.
            refreshQueue();
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showEdit && current?.kind === "text" && (
        <CardEditorModal
          initial={cards.find((c) => c.deckId === current.deckId && c.id === current.cardId)}
          uid={user?.uid}
          deckId={current.deckId}
          onSave={async (data, tags) => {
            if (user) {
              await updateCard(user.uid, current.deckId, current.cardId, data);
              await setItemTags(
                user.uid,
                current.deckId,
                "card",
                current.cardId,
                tags
              );
            }
            await reloadData();
            refreshQueue();
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

