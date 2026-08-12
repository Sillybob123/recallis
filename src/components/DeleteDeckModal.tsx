import { useState } from "react";
import { Repeat, Trash2, X, Zap } from "lucide-react";
import { trashDeck, TRASH_RETENTION_DAYS, updateDeck } from "../lib/firestore";
import { collectDecks, type DeckNode } from "../lib/deckPath";

type Choice = "quizlet" | "anki" | "both";

/**
 * Both study modes read the same decks, so "delete" is ambiguous: removing a
 * deck from Quizlet shouldn't throw away the spaced-repetition history behind
 * it. This asks which is meant — hiding it from one mode is reversible from
 * the deck menu, while the trash affects everything.
 */
export function DeleteDeckModal({
  uid,
  node,
  onClose,
}: {
  uid: string;
  node: DeckNode;
  onClose: () => void;
}) {
  const [choice, setChoice] = useState<Choice>("both");
  const [busy, setBusy] = useState(false);
  const decks = collectDecks(node);
  const subdecks = decks.length - 1;

  async function apply() {
    setBusy(true);
    try {
      if (choice === "both") {
        for (const d of decks) await trashDeck(uid, d.id);
      } else {
        const key = choice === "anki" ? "hiddenInAnki" : "hiddenInQuizlet";
        for (const d of decks) await updateDeck(uid, d.id, { [key]: true });
      }
      onClose();
    } catch (err) {
      alert("Couldn't apply that: " + (err as Error).message);
      setBusy(false);
    }
  }

  const options: { id: Choice; icon: React.ReactNode; title: string; body: string }[] = [
    {
      id: "quizlet",
      icon: <Zap size={15} className="text-red-600" />,
      title: "Remove from Quizlet only",
      body: "Disappears from Quizlet's lists. Keeps its cards and Anki schedule, and you can add it back any time from the deck menu.",
    },
    {
      id: "anki",
      icon: <Repeat size={15} className="text-emerald-600" />,
      title: "Remove from Anki only",
      body: "Stops appearing for scheduled review, but stays available to repeat in Quizlet. Its review history is kept.",
    },
    {
      id: "both",
      icon: <Trash2 size={15} className="text-slate-600" />,
      title: "Delete everywhere",
      body: `Moves it to the trash for ${TRASH_RETENTION_DAYS} days, then cards, images, and schedules are permanently deleted.`,
    },
  ];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-1 flex items-start justify-between">
          <h2 className="text-lg font-bold text-slate-900">
            Delete “{node.name}”
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          {subdecks > 0
            ? `This also covers its ${subdecks} subdeck${subdecks === 1 ? "" : "s"}.`
            : "Choose what should happen to it."}
        </p>

        <div className="space-y-2">
          {options.map((opt) => (
            <label
              key={opt.id}
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                choice === opt.id
                  ? "border-indigo-400 bg-indigo-50"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="radio"
                checked={choice === opt.id}
                onChange={() => setChoice(opt.id)}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                  {opt.icon}
                  {opt.title}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                  {opt.body}
                </span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={apply}
            disabled={busy}
            className={`rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 ${
              choice === "both"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {busy
              ? "Working…"
              : choice === "both"
                ? "Move to trash"
                : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
