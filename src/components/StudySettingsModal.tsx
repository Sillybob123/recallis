import { useState } from "react";
import { X } from "lucide-react";
import {
  formatSteps,
  parseSteps,
  saveAnkiSettings,
  saveQuizletSettings,
  type AnkiSettings,
  type QuizletSettings,
} from "../lib/settings";
import type { StudyMode } from "../contexts/StudyModeContext";

export function StudySettingsModal({
  studyMode,
  anki,
  quizlet,
  ankiStats,
  onChange,
  onClose,
}: {
  studyMode: StudyMode;
  anki: AnkiSettings;
  quizlet: QuizletSettings;
  ankiStats?: { studiedToday: number; msToday: number; dueTomorrow: number };
  onChange: (anki: AnkiSettings, quizlet: QuizletSettings) => void;
  onClose: () => void;
}) {
  const [a, setA] = useState<AnkiSettings>({ ...anki });
  const [q, setQ] = useState<QuizletSettings>({ ...quizlet });
  const [learnStepsText, setLearnStepsText] = useState(formatSteps(anki.learnStepsMin));
  const [relearnStepsText, setRelearnStepsText] = useState(
    formatSteps(anki.relearnStepsMin)
  );

  function save() {
    const finalA: AnkiSettings = {
      ...a,
      learnStepsMin: parseSteps(learnStepsText),
      relearnStepsMin: parseSteps(relearnStepsText),
    };
    saveAnkiSettings(finalA);
    saveQuizletSettings(q);
    onChange(finalA, q);
    onClose();
  }

  const num = (v: string, fallback: number) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Study settings</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {studyMode === "anki" ? (
          <div className="space-y-5">
            <section>
              <h3 className="mb-2 text-sm font-bold text-slate-700">Daily Limits</h3>
              <div className="space-y-3">
                <label className="flex items-center justify-between gap-3 text-sm text-slate-600">
                  New cards/day
                  <input
                    type="number"
                    min={0}
                    value={a.newPerDay}
                    onChange={(e) =>
                      setA({ ...a, newPerDay: num(e.target.value, a.newPerDay) })
                    }
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm outline-none focus:border-indigo-500"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm text-slate-600">
                  Maximum reviews/day
                  <input
                    type="number"
                    min={0}
                    value={a.maxReviewsPerDay}
                    onChange={(e) =>
                      setA({
                        ...a,
                        maxReviewsPerDay: num(e.target.value, a.maxReviewsPerDay),
                      })
                    }
                    className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm outline-none focus:border-indigo-500"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm text-slate-600">
                  New cards ignore review limit
                  <input
                    type="checkbox"
                    checked={a.newIgnoreReviewLimit}
                    onChange={(e) =>
                      setA({ ...a, newIgnoreReviewLimit: e.target.checked })
                    }
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm text-slate-600">
                  Limits start from top
                  <input
                    type="checkbox"
                    checked={a.limitsStartFromTop}
                    onChange={(e) =>
                      setA({ ...a, limitsStartFromTop: e.target.checked })
                    }
                  />
                </label>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-bold text-slate-700">New Cards</h3>
              <label className="flex items-center justify-between gap-3 text-sm text-slate-600">
                Learning steps
                <input
                  value={learnStepsText}
                  onChange={(e) => setLearnStepsText(e.target.value)}
                  placeholder="10m"
                  className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm outline-none focus:border-indigo-500"
                />
              </label>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-bold text-slate-700">Lapses</h3>
              <label className="flex items-center justify-between gap-3 text-sm text-slate-600">
                Relearning steps
                <input
                  value={relearnStepsText}
                  onChange={(e) => setRelearnStepsText(e.target.value)}
                  placeholder="10m"
                  className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm outline-none focus:border-indigo-500"
                />
              </label>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-bold text-slate-700">FSRS</h3>
              <label className="flex items-center justify-between gap-3 text-sm text-slate-600">
                Desired retention (%)
                <input
                  type="number"
                  min={70}
                  max={99}
                  value={a.desiredRetentionPct}
                  onChange={(e) =>
                    setA({ ...a, desiredRetentionPct: num(e.target.value, a.desiredRetentionPct) })
                  }
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm outline-none focus:border-indigo-500"
                />
              </label>
              <p className="mt-1 text-xs text-slate-400">
                Higher retention = shorter intervals, more reviews. Scheduling uses FSRS-6.
              </p>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-bold text-slate-700">Advanced</h3>
              <label className="flex items-center justify-between gap-3 text-sm text-slate-600">
                Maximum interval (days)
                <input
                  type="number"
                  min={1}
                  value={a.maxIntervalDays}
                  onChange={(e) =>
                    setA({ ...a, maxIntervalDays: num(e.target.value, a.maxIntervalDays) })
                  }
                  className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm outline-none focus:border-indigo-500"
                />
              </label>
            </section>
          </div>
        ) : (
          <div className="space-y-5">
            <section>
              <h3 className="mb-2 text-sm font-bold text-slate-700">Question types (Learn)</h3>
              <div className="space-y-2">
                <label className="flex items-center justify-between text-sm text-slate-600">
                  Multiple choice
                  <input
                    type="checkbox"
                    checked={q.enableMultipleChoice}
                    onChange={(e) =>
                      setQ({ ...q, enableMultipleChoice: e.target.checked })
                    }
                  />
                </label>
                <label className="flex items-center justify-between text-sm text-slate-600">
                  Written
                  <input
                    type="checkbox"
                    checked={q.enableWritten}
                    onChange={(e) => setQ({ ...q, enableWritten: e.target.checked })}
                  />
                </label>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-bold text-slate-700">Answer with</h3>
              <div className="flex gap-2 rounded-lg bg-slate-100 p-1 text-sm">
                <button
                  onClick={() => setQ({ ...q, answerWith: "definition" })}
                  className={`flex-1 rounded-md py-1.5 font-medium transition ${
                    q.answerWith === "definition"
                      ? "bg-white shadow-sm text-slate-900"
                      : "text-slate-500"
                  }`}
                >
                  Definition
                </button>
                <button
                  onClick={() => setQ({ ...q, answerWith: "term" })}
                  className={`flex-1 rounded-md py-1.5 font-medium transition ${
                    q.answerWith === "term"
                      ? "bg-white shadow-sm text-slate-900"
                      : "text-slate-500"
                  }`}
                >
                  Term
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Applies to basic front/back cards.
              </p>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-bold text-slate-700">Grading options</h3>
              <div className="space-y-2">
                {(
                  [
                    [
                      "relaxed",
                      "Relaxed",
                      "General meaning is enough — synonym-ish answers, rephrasing, and typos accepted.",
                    ],
                    [
                      "moderate",
                      "Moderate",
                      "Exact match required, but misspellings are accepted.",
                    ],
                    [
                      "strict",
                      "Strict",
                      "Exact match required. Only case, punctuation, and parentheses are forgiven.",
                    ],
                  ] as const
                ).map(([value, label, desc]) => (
                  <label
                    key={value}
                    className={`block cursor-pointer rounded-lg border p-2.5 text-sm transition ${
                      q.grading === value
                        ? "border-indigo-400 bg-indigo-50"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-medium text-slate-800">
                      <input
                        type="radio"
                        checked={q.grading === value}
                        onChange={() => setQ({ ...q, grading: value })}
                      />
                      {label}
                    </span>
                    <span className="mt-0.5 block pl-5 text-xs text-slate-500">{desc}</span>
                  </label>
                ))}
              </div>
            </section>

            <label className="flex items-center justify-between text-sm text-slate-600">
              Retype correct answers after a miss
              <input
                type="checkbox"
                checked={q.retypeCorrect}
                onChange={(e) => setQ({ ...q, retypeCorrect: e.target.checked })}
              />
            </label>
          </div>
        )}

        {studyMode === "anki" && ankiStats && (
          <div className="mt-5 rounded-xl bg-slate-50 p-3 text-center text-sm text-slate-600">
            {ankiStats.studiedToday > 0 ? (
              <p>
                Studied <b>{ankiStats.studiedToday}</b> card
                {ankiStats.studiedToday === 1 ? "" : "s"} in{" "}
                <b>{Math.round(ankiStats.msToday / 1000)}</b> seconds today (
                {(ankiStats.msToday / 1000 / ankiStats.studiedToday).toFixed(1)}
                s/card).
              </p>
            ) : (
              <p>No cards studied yet today.</p>
            )}
            <p className="mt-1">
              <b>{ankiStats.dueTomorrow}</b> card
              {ankiStats.dueTomorrow === 1 ? "" : "s"} due tomorrow.
            </p>
          </div>
        )}

        <button
          onClick={save}
          className="mt-6 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
        >
          Save settings
        </button>
      </div>
    </div>
  );
}
