import { useState } from "react";
import { X } from "lucide-react";
import {
  parseBasicBulk,
  parseClozeBulk,
  type TermSeparator,
  type CardSeparator,
} from "../lib/bulkImport";
import type { CardData } from "../types";

export function BulkImportModal({
  onImport,
  onClose,
}: {
  onImport: (cards: CardData[]) => Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"basic" | "cloze">("basic");
  const [text, setText] = useState("");
  const [termSep, setTermSep] = useState<TermSeparator>("\t");
  const [cardSep, setCardSep] = useState<CardSeparator>("\n");
  const [busy, setBusy] = useState(false);

  const preview =
    mode === "basic" ? parseBasicBulk(text, termSep, cardSep) : parseClozeBulk(text);

  async function handleImport() {
    if (preview.length === 0) return;
    setBusy(true);
    await onImport(preview);
    setBusy(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Bulk import</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="mb-3 flex gap-2 rounded-lg bg-slate-100 p-1 text-sm">
          <button
            onClick={() => setMode("basic")}
            className={`flex-1 rounded-md py-1.5 font-medium transition ${
              mode === "basic" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"
            }`}
          >
            Term / Definition (Quizlet-style paste)
          </button>
          <button
            onClick={() => setMode("cloze")}
            className={`flex-1 rounded-md py-1.5 font-medium transition ${
              mode === "cloze" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"
            }`}
          >
            Cloze blocks
          </button>
        </div>

        {mode === "basic" && (
          <div className="mb-3 flex flex-wrap gap-4 text-xs text-slate-500">
            <label className="flex items-center gap-1.5">
              Between term & definition:
              <select
                value={termSep}
                onChange={(e) => setTermSep(e.target.value as TermSeparator)}
                className="rounded border border-slate-300 px-1.5 py-1"
              >
                <option value="\t">Tab</option>
                <option value=",">Comma</option>
                <option value=" - ">Dash ( - )</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              Between cards:
              <select
                value={cardSep}
                onChange={(e) => setCardSep(e.target.value as CardSeparator)}
                className="rounded border border-slate-300 px-1.5 py-1"
              >
                <option value="\n">New line</option>
                <option value="\n\n">Blank line</option>
              </select>
            </label>
          </div>
        )}
        {mode === "cloze" && (
          <p className="mb-3 text-xs text-slate-500">
            Paste one or more blocks separated by a blank line. Each block needs
            at least one <code className="rounded bg-slate-100 px-1">{"{{c1::...}}"}</code>{" "}
            deletion.
          </p>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={
            mode === "basic"
              ? "Anterior\tToward the front\nPosterior\tToward the back"
              : "The {{c1::heart}} has four chambers.\n\nThe {{c1::liver}} is in the {{c2::right upper quadrant}}."
          }
          className="w-full flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />

        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-slate-500">
            {preview.length} card{preview.length === 1 ? "" : "s"} detected
          </span>
          <button
            onClick={handleImport}
            disabled={busy || preview.length === 0}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Importing…" : `Import ${preview.length} card${preview.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
