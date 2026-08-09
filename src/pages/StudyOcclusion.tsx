import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, PartyPopper, RotateCcw } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Layout } from "../components/Layout";
import { ShapeOverlay } from "../components/ShapeOverlay";
import { ZoomPan } from "../components/ZoomPan";
import { watchOcclusions } from "../lib/firestore";
import { buildUnits, type ShapeUnit } from "../lib/shapes";
import type { OcclusionSheet } from "../types";
import { shuffle } from "../lib/text";

interface StudyItem {
  key: string;
  sheet: OcclusionSheet;
  unit: ShapeUnit;
  allUnits: ShapeUnit[];
}

function buildItems(sheets: OcclusionSheet[]): StudyItem[] {
  const items: StudyItem[] = [];
  for (const sheet of sheets) {
    const units = buildUnits(sheet.shapes);
    for (const unit of units) {
      items.push({ key: `${sheet.id}-${unit.key}`, sheet, unit, allUnits: units });
    }
  }
  return items;
}

export function StudyOcclusion() {
  const { deckId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [sheets, setSheets] = useState<OcclusionSheet[] | null>(null);
  const [queue, setQueue] = useState<StudyItem[]>([]);
  const [total, setTotal] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [mode, setMode] = useState<"hideOne" | "hideAll">("hideOne");

  useEffect(() => {
    if (!user || !deckId) return;
    return watchOcclusions(user.uid, deckId, setSheets);
  }, [user, deckId]);

  useEffect(() => {
    if (!sheets) return;
    const items = shuffle(buildItems(sheets));
    setQueue(items);
    setTotal(items.length);
    // Rebuild only when sheets first load, not on every background snapshot —
    // otherwise mid-session writes would reshuffle the queue under you.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheets === null]);

  const current = queue[0];

  function restart() {
    if (!sheets) return;
    const items = shuffle(buildItems(sheets));
    setQueue(items);
    setTotal(items.length);
    setRevealed(false);
  }

  function mark(correct: boolean) {
    setQueue((prev) => (correct ? prev.slice(1) : [...prev.slice(1), prev[0]]));
    setRevealed(false);
  }

  // Space = reveal, then Space = got it / X = still learning.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (!queue.length) return;
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        if (!revealed) setRevealed(true);
        else mark(true);
      } else if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        if (!revealed) setRevealed(true);
        else mark(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const progress = total > 0 ? Math.round(((total - queue.length) / total) * 100) : 0;

  if (!sheets) {
    return (
      <Layout>
        <div className="py-24 text-center text-slate-400">Loading…</div>
      </Layout>
    );
  }

  if (total === 0) {
    return (
      <Layout>
        <BackLink deckId={deckId!} navigate={navigate} />
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center">
          <p className="font-medium text-slate-700">No image occlusion sheets yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Upload an image and draw masks from the deck page first.
          </p>
        </div>
      </Layout>
    );
  }

  // Which shapes are covered right now?
  let hiddenIds = new Set<string>();
  let targetIds = new Set<string>();
  let outlineIds: Set<string> | undefined;
  if (current) {
    const targetShapeIds = new Set(current.unit.shapeIds);
    targetIds = targetShapeIds;
    if (!revealed) {
      hiddenIds =
        mode === "hideOne"
          ? targetShapeIds
          : new Set(current.sheet.shapes.map((s) => s.id));
    } else {
      // Answer view: target uncovered but outlined; in hide-all mode the
      // other masks stay covered for context.
      outlineIds = targetShapeIds;
      hiddenIds =
        mode === "hideAll"
          ? new Set(
              current.sheet.shapes
                .map((s) => s.id)
                .filter((id) => !targetShapeIds.has(id))
            )
          : new Set();
    }
  }

  return (
    <Layout>
      <BackLink deckId={deckId!} navigate={navigate} />

      <div className="mb-4 flex items-center justify-between">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-indigo-600 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="ml-3 text-sm font-medium text-slate-500">
          {total - queue.length}/{total}
        </span>
      </div>

      <div className="mb-4 flex justify-center gap-2 text-sm">
        <button
          onClick={() => {
            setMode("hideOne");
            setRevealed(false);
          }}
          className={`rounded-full px-3 py-1 font-medium transition ${
            mode === "hideOne" ? "bg-indigo-600 text-white" : "bg-white text-slate-500 border border-slate-200"
          }`}
        >
          Hide one, guess one
        </button>
        <button
          onClick={() => {
            setMode("hideAll");
            setRevealed(false);
          }}
          className={`rounded-full px-3 py-1 font-medium transition ${
            mode === "hideAll" ? "bg-indigo-600 text-white" : "bg-white text-slate-500 border border-slate-200"
          }`}
        >
          Hide all, guess one
        </button>
      </div>

      {!current ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 py-20 text-center">
          <PartyPopper className="mx-auto mb-3 text-emerald-500" size={40} />
          <p className="mb-1 text-lg font-bold text-emerald-800">
            All masks studied for this round!
          </p>
          <p className="mb-5 text-sm text-emerald-700">
            {total} card{total === 1 ? "" : "s"} covered.
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={restart}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              <RotateCcw size={14} /> Study again
            </button>
            <button
              onClick={() => navigate(`/deck/${deckId}`)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-white"
            >
              Back to deck
            </button>
          </div>
        </div>
      ) : (
        <div>
          <ZoomPan
            resetKey={current.key}
            className="mx-auto w-full max-w-2xl rounded-xl border border-slate-200 bg-white"
          >
            <img
              src={current.sheet.imageUrl}
              alt=""
              className="block h-auto w-full select-none"
              draggable={false}
            />
            <ShapeOverlay
              shapes={current.sheet.shapes}
              hiddenIds={hiddenIds}
              targetIds={targetIds}
              outlineIds={outlineIds}
            />
          </ZoomPan>

          {current.unit.label && revealed && (
            <p className="mt-3 text-center text-lg font-semibold text-slate-900">
              {current.unit.label}
            </p>
          )}

          <div className="mx-auto mt-5 flex max-w-2xl justify-center gap-3">
            {!revealed ? (
              <button
                onClick={() => setRevealed(true)}
                className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
              >
                Reveal
              </button>
            ) : (
              <>
                <button
                  onClick={() => mark(false)}
                  className="flex-1 rounded-xl border border-red-200 bg-red-50 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-100"
                >
                  Still learning
                </button>
                <button
                  onClick={() => mark(true)}
                  className="flex-1 rounded-xl border border-emerald-200 bg-emerald-50 py-3 text-sm font-semibold text-emerald-600 transition hover:bg-emerald-100"
                >
                  Got it
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}

function BackLink({
  deckId,
  navigate,
}: {
  deckId: string;
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <button
      onClick={() => navigate(`/deck/${deckId}`)}
      className="mb-4 flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
    >
      <ArrowLeft size={15} /> Back to deck
    </button>
  );
}
