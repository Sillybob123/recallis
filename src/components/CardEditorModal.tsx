import { useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { Card, CardData } from "../types";
import { RichTextEditor } from "./RichTextEditor";
import { uploadDeckMedia } from "../lib/firestore";
import { formatTagString, parseTagString } from "../lib/tags";

export function CardEditorModal({
  initial,
  uid,
  deckId,
  onSave,
  onClose,
}: {
  initial?: Card;
  uid?: string;
  deckId?: string;
  onSave: (data: CardData, tags: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<"basic" | "cloze">(initial?.data.type ?? "basic");
  const [front, setFront] = useState(
    initial?.data.type === "basic" ? initial.data.front : ""
  );
  const [back, setBack] = useState(
    initial?.data.type === "basic" ? initial.data.back : ""
  );
  const [clozeText, setClozeText] = useState(
    initial?.data.type === "cloze" ? initial.data.text : ""
  );
  const [extra, setExtra] = useState(
    initial?.data.type === "cloze" ? initial.data.extra ?? "" : ""
  );
  const [tagText, setTagText] = useState(
    formatTagString(initial?.tags)
  );
  const [busy, setBusy] = useState(false);

  const uploadImage =
    uid && deckId
      ? async (file: File) => {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const { url } = await uploadDeckMedia(uid, deckId, file.name, bytes);
          return url;
        }
      : undefined;

  function isEmptyHtml(html: string): boolean {
    const div = document.createElement("div");
    div.innerHTML = html;
    return !div.textContent?.trim() && !div.querySelector("img");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (type === "basic") {
        if (isEmptyHtml(front) || isEmptyHtml(back)) return;
        await onSave({ type: "basic", front, back }, parseTagString(tagText));
      } else {
        if (isEmptyHtml(clozeText) || !/\{\{c\d+::/.test(clozeText)) {
          alert(
            "A cloze card needs at least one {{c1::…}} deletion — select some text and use the [ ]+ button (or ⌘⇧C)."
          );
          return;
        }
        await onSave(
          {
            type: "cloze",
            text: clozeText,
            extra: isEmptyHtml(extra) ? undefined : extra,
          },
          parseTagString(tagText)
        );
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">
            {initial ? "Edit card" : "New card"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        {!initial && (
          <div className="mb-4 flex gap-2 rounded-lg bg-slate-100 p-1 text-sm">
            <button
              type="button"
              onClick={() => setType("basic")}
              className={`flex-1 rounded-md py-1.5 font-medium transition ${
                type === "basic" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"
              }`}
            >
              Basic (front / back)
            </button>
            <button
              type="button"
              onClick={() => setType("cloze")}
              className={`flex-1 rounded-md py-1.5 font-medium transition ${
                type === "cloze" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"
              }`}
            >
              Cloze (fill-in-blank)
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {type === "basic" ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Front</label>
                <RichTextEditor
                  value={front}
                  onChange={setFront}
                  placeholder="Term or question"
                  onUploadImage={uploadImage}
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Back</label>
                <RichTextEditor
                  value={back}
                  onChange={setBack}
                  placeholder="Definition or answer"
                  onUploadImage={uploadImage}
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Text — select what to hide and press the{" "}
                  <code className="rounded bg-slate-100 px-1">[ ]+</code> button (⌘⇧C).
                  Use <code className="rounded bg-slate-100 px-1">[ ]=</code> to group
                  blanks onto the same card.
                </label>
                <RichTextEditor
                  value={clozeText}
                  onChange={setClozeText}
                  placeholder="The heart has four chambers."
                  cloze
                  minHeightClass="min-h-28"
                  onUploadImage={uploadImage}
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Extra info (optional, shown after answering)
                </label>
                <RichTextEditor
                  value={extra}
                  onChange={setExtra}
                  placeholder="Mnemonic, context, or source"
                  onUploadImage={uploadImage}
                />
              </div>
            </>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              Tags{" "}
              <span className="font-normal text-slate-400">
                — space-separated, :: for hierarchy (anatomy::thorax)
              </span>
            </span>
            <input
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              placeholder="anatomy thorax"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : initial ? "Save changes" : "Add card"}
          </button>
        </form>
      </div>
    </div>
  );
}
