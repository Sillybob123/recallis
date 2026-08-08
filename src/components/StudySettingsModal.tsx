import { useState, type ReactNode } from "react";
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
  onChange,
  onClose,
}: {
  studyMode: StudyMode;
  anki: AnkiSettings;
  quizlet: QuizletSettings;
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Study settings</h2>
            <p className="text-xs text-slate-500">
              {studyMode === "anki"
                ? "How spaced repetition schedules your cards."
                : "How cram sessions ask and grade you."}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {studyMode === "anki" ? (
            <div className="grid gap-5 md:grid-cols-2">
              <Card title="Daily Limits" className="md:col-span-2">
                <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <NumberField
                    label="New cards/day"
                    value={a.newPerDay}
                    onChange={(v) => setA({ ...a, newPerDay: num(v, a.newPerDay) })}
                  />
                  <NumberField
                    label="Maximum reviews/day"
                    value={a.maxReviewsPerDay}
                    onChange={(v) =>
                      setA({ ...a, maxReviewsPerDay: num(v, a.maxReviewsPerDay) })
                    }
                  />
                  <ToggleField
                    label="New cards ignore review limit"
                    checked={a.newIgnoreReviewLimit}
                    onChange={(c) => setA({ ...a, newIgnoreReviewLimit: c })}
                  />
                  <ToggleField
                    label="Limits start from top"
                    checked={a.limitsStartFromTop}
                    onChange={(c) => setA({ ...a, limitsStartFromTop: c })}
                  />
                </div>
              </Card>

              <Card title="New Cards">
                <TextField
                  label="Learning steps"
                  value={learnStepsText}
                  onChange={setLearnStepsText}
                  placeholder="10m"
                  hint="Space-separated, e.g. 1m 10m"
                />
              </Card>

              <Card title="Lapses">
                <TextField
                  label="Relearning steps"
                  value={relearnStepsText}
                  onChange={setRelearnStepsText}
                  placeholder="10m"
                  hint="Used after you press Again on a review"
                />
              </Card>

              <Card title="FSRS">
                <NumberField
                  label="Desired retention (%)"
                  value={a.desiredRetentionPct}
                  onChange={(v) =>
                    setA({ ...a, desiredRetentionPct: num(v, a.desiredRetentionPct) })
                  }
                />
                <p className="mt-2 text-xs leading-snug text-slate-400">
                  Higher retention means shorter intervals and more reviews.
                  Scheduling uses FSRS-6.
                </p>
              </Card>

              <Card title="Advanced">
                <NumberField
                  label="Maximum interval (days)"
                  value={a.maxIntervalDays}
                  onChange={(v) =>
                    setA({ ...a, maxIntervalDays: num(v, a.maxIntervalDays) })
                  }
                />
                <p className="mt-2 text-xs leading-snug text-slate-400">
                  Caps how far ahead a card can ever be scheduled.
                </p>
              </Card>
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              <Card title="Question types (Learn)">
                <div className="space-y-2">
                  <ToggleField
                    label="Multiple choice"
                    checked={q.enableMultipleChoice}
                    onChange={(c) => setQ({ ...q, enableMultipleChoice: c })}
                  />
                  <ToggleField
                    label="Written"
                    checked={q.enableWritten}
                    onChange={(c) => setQ({ ...q, enableWritten: c })}
                  />
                </div>
              </Card>

              <Card title="Answer with">
                <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
                  {(["definition", "term"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setQ({ ...q, answerWith: v })}
                      className={`flex-1 rounded-md py-1.5 font-medium capitalize transition ${
                        q.answerWith === v
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Applies to basic front/back cards.
                </p>
              </Card>

              <Card title="Grading" className="md:col-span-2">
                <div className="grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      [
                        "relaxed",
                        "Relaxed",
                        "General meaning is enough — rephrasing and typos accepted.",
                      ],
                      [
                        "moderate",
                        "Moderate",
                        "Exact match, but misspellings are accepted.",
                      ],
                      [
                        "strict",
                        "Strict",
                        "Exact match. Only case and punctuation forgiven.",
                      ],
                    ] as const
                  ).map(([value, label, desc]) => (
                    <label
                      key={value}
                      className={`cursor-pointer rounded-lg border p-3 text-sm transition ${
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
                      <span className="mt-1 block text-xs leading-snug text-slate-500">
                        {desc}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="mt-3">
                  <ToggleField
                    label="Retype correct answers after a miss"
                    checked={q.retypeCorrect}
                    onChange={(c) => setQ({ ...q, retypeCorrect: c })}
                  />
                </div>
              </Card>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
          >
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-slate-200 p-4 ${className}`}>
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-slate-600">
      {label}
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm outline-none focus:border-indigo-500"
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <label className="block text-sm text-slate-600">
      <span className="flex items-center justify-between gap-3">
        {label}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm outline-none focus:border-indigo-500"
        />
      </span>
      {hint && <span className="mt-1.5 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (c: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-slate-600">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-indigo-600"
      />
    </label>
  );
}
