import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ref, getBlob } from "firebase/storage";
import {
  ArrowLeft,
  FilePlus2,
  Scissors,
  ScanEye,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Layout } from "../components/Layout";
import { RichTextEditor } from "../components/RichTextEditor";
import { storage } from "../firebase";
import {
  createCard,
  createOcclusionSheet,
  getNote,
  updateNote,
  uploadDeckMedia,
  uploadNoteSlide,
  uploadOcclusionImage,
  watchDecks,
} from "../lib/firestore";
import type { CardData, Deck, Note, NoteSlide } from "../types";

export function NoteEditorPage() {
  const { noteId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [note, setNote] = useState<Note | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
  const [slideProgress, setSlideProgress] = useState<string | null>(null);
  const [cardPrefill, setCardPrefill] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Note | null>(null);

  useEffect(() => {
    if (!user || !noteId) return;
    getNote(user.uid, noteId).then((n) => {
      if (!n) {
        navigate("/notes");
        return;
      }
      setNote(n);
      latest.current = n;
    });
    return watchDecks(user.uid, setDecks);
  }, [user, noteId, navigate]);

  // Debounced autosave: any change persists ~1.5s after you stop typing.
  const scheduleSave = useCallback(
    (updated: Note) => {
      latest.current = updated;
      setNote(updated);
      setSaveState("dirty");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        if (!user || !noteId || !latest.current) return;
        setSaveState("saving");
        try {
          const n = latest.current;
          await updateNote(user.uid, noteId, {
            title: n.title,
            className: n.className,
            content: n.content,
            slides: n.slides,
          });
          setSaveState("saved");
        } catch {
          setSaveState("dirty"); // retried on next edit
        }
      }, 1500);
    },
    [user, noteId]
  );

  // Flush pending save when leaving the page.
  useEffect(() => {
    return () => {
      if (saveTimer.current && user && noteId && latest.current) {
        clearTimeout(saveTimer.current);
        const n = latest.current;
        updateNote(user.uid, noteId, {
          title: n.title,
          className: n.className,
          content: n.content,
          slides: n.slides,
        }).catch(() => {});
      }
    };
  }, [user, noteId]);

  async function handlePdfUpload(file: File) {
    if (!user || !noteId || !note) return;
    setSlideProgress("Reading PDF…");
    try {
      const { renderPdfToSlides } = await import("../lib/pdfSlides");
      const blobs = await renderPdfToSlides(file, (done, total) =>
        setSlideProgress(`Rendering slides ${done}/${total}…`)
      );
      const newSlides: NoteSlide[] = [];
      for (let i = 0; i < blobs.length; i++) {
        setSlideProgress(`Uploading slide ${i + 1}/${blobs.length}…`);
        const { path, url } = await uploadNoteSlide(user.uid, noteId, blobs[i]);
        newSlides.push({ id: crypto.randomUUID(), imagePath: path, imageUrl: url, note: "" });
      }
      scheduleSave({ ...latest.current!, slides: [...latest.current!.slides, ...newSlides] });
    } catch (err) {
      alert(
        "Couldn't read that file: " +
          (err as Error).message +
          "\n\nTip: if it's a PowerPoint, export it as PDF first (File → Save As → PDF)."
      );
    } finally {
      setSlideProgress(null);
    }
  }

  function updateSlide(id: string, patch: Partial<NoteSlide>) {
    const n = latest.current!;
    scheduleSave({
      ...n,
      slides: n.slides.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  }

  function removeSlide(id: string) {
    const n = latest.current!;
    if (!confirm("Remove this slide (and its slide notes) from the note?")) return;
    scheduleSave({ ...n, slides: n.slides.filter((s) => s.id !== id) });
  }

  /** Turn a slide into an image-occlusion sheet in a chosen deck. */
  async function slideToOcclusion(slide: NoteSlide, deckId: string) {
    if (!user || !note) return;
    try {
      const blob = await getBlob(ref(storage, slide.imagePath));
      const file = new File([blob], "slide.png", { type: "image/png" });
      const { path, url } = await uploadOcclusionImage(user.uid, deckId, file);
      const img = await createImageBitmap(blob);
      const sheetId = await createOcclusionSheet(user.uid, deckId, {
        title: note.title,
        imagePath: path,
        imageUrl: url,
        imageWidth: img.width,
        imageHeight: img.height,
        shapes: [],
      });
      img.close();
      navigate(`/deck/${deckId}/occlusion/${sheetId}/edit`);
    } catch (err) {
      alert(
        "Couldn't copy the slide image: " +
          (err as Error).message +
          "\n\nIf this mentions CORS, your Storage bucket needs the one-time CORS setup from the README (section 4)."
      );
    }
  }

  /** Grab the current text selection as HTML for a new card. */
  function captureSelection(): string {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return "";
    const div = document.createElement("div");
    div.appendChild(sel.getRangeAt(0).cloneContents());
    return div.innerHTML;
  }

  if (!note) {
    return (
      <Layout>
        <div className="py-24 text-center text-slate-400">Loading note…</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => navigate("/notes")}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={15} /> All notes
        </button>
        <span
          className={`text-xs font-medium ${
            saveState === "saved" ? "text-emerald-600" : "text-slate-400"
          }`}
        >
          {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : "Editing…"}
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={note.title}
          onChange={(e) => scheduleSave({ ...latest.current!, title: e.target.value })}
          placeholder="Lecture title"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-2xl font-bold text-slate-900 outline-none focus:border-slate-300"
        />
        <input
          value={note.className}
          onChange={(e) => scheduleSave({ ...latest.current!, className: e.target.value })}
          placeholder="Class"
          className="w-36 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
        />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <button
          onMouseDown={(e) => e.preventDefault() /* keep the text selection */}
          onClick={() => {
            const html = captureSelection();
            if (!html) {
              alert("Select some text in your notes first, then click this to turn it into a card.");
              return;
            }
            setCardPrefill(html);
          }}
          className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100"
          title="Highlight text in your notes, then click to make a flashcard from it"
        >
          <Scissors size={14} /> Make card from selection
        </button>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <FilePlus2 size={14} />
          {slideProgress ?? "Add lecture slides (PDF)"}
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={Boolean(slideProgress)}
            onChange={(e) => e.target.files?.[0] && handlePdfUpload(e.target.files[0])}
          />
        </label>
      </div>

      <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
        <RichTextEditor
          value={note.content}
          onChange={(html) => scheduleSave({ ...latest.current!, content: html })}
          placeholder="Type your lecture notes here… Use the toolbar for headings, highlights, lists, and images."
          headings
          minHeightClass="min-h-[40vh]"
          maxHeightClass="max-h-none"
          onUploadImage={async (file) => {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const { url } = await uploadNoteSlide(user!.uid, noteId!, new Blob([bytes], { type: file.type }));
            return url;
          }}
        />
      </div>

      {note.slides.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">
            Lecture slides ({note.slides.length}) — take notes under each one
          </h2>
          <div className="space-y-6">
            {note.slides.map((slide, i) => (
              <div
                key={slide.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
                  <span className="text-xs font-semibold text-slate-400">
                    Slide {i + 1}
                  </span>
                  <div className="flex gap-1">
                    <SlideToOcclusionButton
                      decks={decks}
                      onPick={(deckId) => slideToOcclusion(slide, deckId)}
                    />
                    <button
                      onClick={() => removeSlide(slide.id)}
                      className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
                      title="Remove slide"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <img
                  src={slide.imageUrl}
                  alt={`Slide ${i + 1}`}
                  loading="lazy"
                  className="block w-full"
                />
                <div className="border-t border-slate-100 p-2">
                  <RichTextEditor
                    value={slide.note}
                    onChange={(html) => updateSlide(slide.id, { note: html })}
                    placeholder="Notes for this slide…"
                    minHeightClass="min-h-12"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {cardPrefill !== null && (
        <MakeCardModal
          decks={decks}
          prefillHtml={cardPrefill}
          onClose={() => setCardPrefill(null)}
          onSave={async (deckId, data) => {
            await createCard(user!.uid, deckId, data);
          }}
          uploadImage={async (file) => {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const target = decks[0];
            if (!target) throw new Error("Create a deck first.");
            const { url } = await uploadDeckMedia(user!.uid, target.id, file.name, bytes);
            return url;
          }}
        />
      )}
    </Layout>
  );
}

function SlideToOcclusionButton({
  decks,
  onPick,
}: {
  decks: Deck[];
  onPick: (deckId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        title="Open this slide in the occlusion editor — draw masks, save to a deck"
      >
        <ScanEye size={13} /> Make occlusion
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 max-h-64 w-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {decks.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-400">No decks yet — create one first.</p>
          ) : (
            decks.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  setOpen(false);
                  onPick(d.id);
                }}
                className="block w-full truncate px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                {d.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function MakeCardModal({
  decks,
  prefillHtml,
  onSave,
  onClose,
  uploadImage,
}: {
  decks: Deck[];
  prefillHtml: string;
  onSave: (deckId: string, data: CardData) => Promise<void>;
  onClose: () => void;
  uploadImage: (file: File) => Promise<string>;
}) {
  const [deckId, setDeckId] = useState(decks[0]?.id ?? "");
  const [type, setType] = useState<"cloze" | "basic">("cloze");
  const [text, setText] = useState(prefillHtml);
  const [front, setFront] = useState(prefillHtml);
  const [back, setBack] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);

  async function handleSave(keepOpen: boolean) {
    if (!deckId) {
      alert("Pick a deck first (or create one on the dashboard).");
      return;
    }
    if (type === "cloze" && !/\{\{c\d+::/.test(text)) {
      alert("Select the part to hide and press the [ ]+ button (or ⌘⇧C) to add a {{c1::…}} blank.");
      return;
    }
    setBusy(true);
    try {
      await onSave(
        deckId,
        type === "cloze" ? { type: "cloze", text } : { type: "basic", front, back }
      );
      setSaved((n) => n + 1);
      if (keepOpen) {
        setText("");
        setFront("");
        setBack("");
      } else {
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">
            New card from your notes{saved > 0 ? ` · ${saved} added` : ""}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="mb-3 flex gap-2">
          <select
            value={deckId}
            onChange={(e) => setDeckId(e.target.value)}
            className="flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-indigo-500"
          >
            <option value="">Choose a deck…</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
            <button
              onClick={() => setType("cloze")}
              className={`rounded-md px-3 py-1 font-medium transition ${
                type === "cloze" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"
              }`}
            >
              Cloze
            </button>
            <button
              onClick={() => setType("basic")}
              className={`rounded-md px-3 py-1 font-medium transition ${
                type === "basic" ? "bg-white shadow-sm text-slate-900" : "text-slate-500"
              }`}
            >
              Basic
            </button>
          </div>
        </div>

        {type === "cloze" ? (
          <RichTextEditor
            value={text}
            onChange={setText}
            cloze
            placeholder="Your selected text — now hide the answer with [ ]+ (⌘⇧C)"
            minHeightClass="min-h-28"
            onUploadImage={uploadImage}
            autoFocus
          />
        ) : (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Front</label>
              <RichTextEditor
                value={front}
                onChange={setFront}
                placeholder="Question"
                onUploadImage={uploadImage}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Back</label>
              <RichTextEditor
                value={back}
                onChange={setBack}
                placeholder="Answer"
                onUploadImage={uploadImage}
              />
            </div>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => handleSave(true)}
            disabled={busy}
            className="flex-1 rounded-lg border border-indigo-200 bg-indigo-50 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Add & make another"}
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={busy}
            className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Add card & close"}
          </button>
        </div>
      </div>
    </div>
  );
}
