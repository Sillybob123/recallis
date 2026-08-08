import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ref, getBlob } from "firebase/storage";
import {
  ArrowLeft,
  Check,
  CloudOff,
  FilePlus2,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
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

type SaveState = "saved" | "saving" | "dirty" | "offline";

export function NoteEditorPage() {
  const { noteId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [note, setNote] = useState<Note | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [slideProgress, setSlideProgress] = useState<string | null>(null);
  const [cardPrefill, setCardPrefill] = useState<string | null>(null);
  const [showNav, setShowNav] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Note | null>(null);
  const slideRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const persist = useCallback(
    async (n: Note) => {
      if (!user || !noteId) return;
      // Firestore's offline cache queues this write and syncs on reconnect,
      // so an offline save still resolves — nothing typed is ever lost.
      await updateNote(user.uid, noteId, {
        title: n.title,
        className: n.className,
        content: n.content,
        slides: n.slides,
      });
    },
    [user, noteId]
  );

  /** Debounced autosave: persists ~1.2s after you stop typing. */
  const scheduleSave = useCallback(
    (updated: Note) => {
      latest.current = updated;
      setNote(updated);
      setSaveState("dirty");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        if (!latest.current) return;
        setSaveState("saving");
        try {
          await persist(latest.current);
          setSavedAt(new Date());
          setSaveState(navigator.onLine ? "saved" : "offline");
        } catch {
          setSaveState("dirty"); // retried on the next edit
        }
      }, 1200);
    },
    [persist]
  );

  // Flush any pending save when leaving the page or closing the tab.
  useEffect(() => {
    function flush() {
      if (saveTimer.current && latest.current) {
        clearTimeout(saveTimer.current);
        persist(latest.current).catch(() => {});
      }
    }
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [persist]);

  async function handleSlideFile(file: File) {
    if (!user || !noteId || !latest.current) return;
    const isPptx = /\.pptx$/i.test(file.name);
    setSlideProgress(isPptx ? "Reading PowerPoint…" : "Reading PDF…");
    try {
      let blobs: Blob[];
      let notice = "";
      if (isPptx) {
        const { renderPptxToSlides } = await import("../lib/pptxSlides");
        const result = await renderPptxToSlides(file, (done, total) =>
          setSlideProgress(`Rendering slides ${done}/${total}…`)
        );
        blobs = result.slides;
        if (result.degradedCount > 0) {
          notice =
            `${result.degradedCount} slide(s) contain charts, SmartArt, or vector art that ` +
            `can't be drawn in the browser, so those parts are missing.\n\n` +
            `For a pixel-perfect copy, open the deck in PowerPoint and use ` +
            `File → Save As → PDF, then upload that PDF instead.`;
        }
      } else {
        const { renderPdfToSlides } = await import("../lib/pdfSlides");
        blobs = await renderPdfToSlides(file, (done, total) =>
          setSlideProgress(`Rendering slides ${done}/${total}…`)
        );
      }

      const newSlides: NoteSlide[] = [];
      for (let i = 0; i < blobs.length; i++) {
        setSlideProgress(`Uploading slide ${i + 1}/${blobs.length}…`);
        const { path, url } = await uploadNoteSlide(user.uid, noteId, blobs[i]);
        newSlides.push({
          id: crypto.randomUUID(),
          imagePath: path,
          imageUrl: url,
          note: "",
        });
      }
      scheduleSave({
        ...latest.current,
        slides: [...latest.current.slides, ...newSlides],
      });
      if (notice) alert(notice);
    } catch (err) {
      alert(
        "Couldn't read that file: " +
          (err as Error).message +
          "\n\nIf it's a PowerPoint that won't open, export it as PDF " +
          "(File → Save As → PDF) and upload that instead."
      );
    } finally {
      setSlideProgress(null);
    }
  }

  function updateSlide(id: string, patch: Partial<NoteSlide>) {
    if (!latest.current) return;
    scheduleSave({
      ...latest.current,
      slides: latest.current.slides.map((s) =>
        s.id === id ? { ...s, ...patch } : s
      ),
    });
  }

  function removeSlide(id: string) {
    if (!latest.current) return;
    if (!confirm("Remove this slide (and its slide notes) from the note?")) return;
    scheduleSave({
      ...latest.current,
      slides: latest.current.slides.filter((s) => s.id !== id),
    });
  }

  /** Copy one specific slide into a deck and open the mask editor on it. */
  async function slideToOcclusion(slide: NoteSlide, index: number, deckId: string) {
    if (!user || !latest.current) return;
    setSlideProgress(`Preparing slide ${index + 1} for occlusion…`);
    try {
      const blob = await getBlob(ref(storage, slide.imagePath));
      const file = new File([blob], `slide-${index + 1}.png`, { type: "image/png" });
      const { path, url } = await uploadOcclusionImage(user.uid, deckId, file);
      const bitmap = await createImageBitmap(blob);
      const sheetId = await createOcclusionSheet(user.uid, deckId, {
        title: `${latest.current.title} — slide ${index + 1}`,
        imagePath: path,
        imageUrl: url,
        imageWidth: bitmap.width,
        imageHeight: bitmap.height,
        shapes: [],
      });
      bitmap.close();
      // Make sure nothing typed is lost before we navigate away.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await persist(latest.current).catch(() => {});
      navigate(`/deck/${deckId}/occlusion/${sheetId}/edit`);
    } catch (err) {
      alert(
        "Couldn't copy that slide: " +
          (err as Error).message +
          "\n\nIf this mentions CORS, your Storage bucket needs the one-time " +
          "CORS setup from the README (section 4)."
      );
    } finally {
      setSlideProgress(null);
    }
  }

  function captureSelection(): string {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return "";
    const div = document.createElement("div");
    div.appendChild(sel.getRangeAt(0).cloneContents());
    return div.innerHTML;
  }

  function jumpToSlide(id: string) {
    slideRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const uploadInlineImage = useCallback(
    async (file: File) => {
      const { url } = await uploadNoteSlide(user!.uid, noteId!, file);
      return url;
    },
    [user, noteId]
  );

  if (!note) {
    return (
      <Layout>
        <div className="py-24 text-center text-slate-400">Loading note…</div>
      </Layout>
    );
  }

  const effectiveSave: SaveState =
    !online && saveState !== "saving" ? "offline" : saveState;

  return (
    <Layout>
      <div className="mb-3 flex items-center justify-between gap-3">
        <button
          onClick={() => navigate("/notes")}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={15} /> All notes
        </button>
        <SaveIndicator state={effectiveSave} savedAt={savedAt} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {note.slides.length > 0 && (
          <button
            onClick={() => setShowNav((v) => !v)}
            title={showNav ? "Hide slide list" : "Show slide list"}
            className="rounded-lg border border-slate-300 bg-white p-2 text-slate-500 hover:bg-slate-50"
          >
            {showNav ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
          </button>
        )}
        <input
          value={note.title}
          onChange={(e) => scheduleSave({ ...latest.current!, title: e.target.value })}
          placeholder="Lecture title"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-2xl font-bold text-slate-900 outline-none focus:border-slate-300"
        />
        <input
          value={note.className}
          onChange={(e) =>
            scheduleSave({ ...latest.current!, className: e.target.value })
          }
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
              alert(
                "Select some text in your notes first, then click this to turn it into a card."
              );
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
          {slideProgress ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <FilePlus2 size={14} />
          )}
          {slideProgress ?? "Add lecture slides (PDF or PPTX)"}
          <input
            type="file"
            accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
            disabled={Boolean(slideProgress)}
            onChange={(e) => e.target.files?.[0] && handleSlideFile(e.target.files[0])}
          />
        </label>
      </div>

      <div className="flex gap-5">
        {/* Slide jump navigation */}
        {showNav && note.slides.length > 0 && (
          <aside className="sticky top-[70px] hidden h-[calc(100vh-100px)] w-36 shrink-0 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 lg:block">
            <p className="mb-2 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Slides
            </p>
            <div className="space-y-1.5">
              {note.slides.map((slide, i) => (
                <button
                  key={slide.id}
                  onClick={() => jumpToSlide(slide.id)}
                  className="group block w-full overflow-hidden rounded-lg border border-slate-200 transition hover:border-indigo-400"
                  title={`Jump to slide ${i + 1}`}
                >
                  <img
                    src={slide.imageUrl}
                    alt=""
                    loading="lazy"
                    className="block w-full"
                  />
                  <span className="block bg-slate-50 py-0.5 text-[10px] font-semibold text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600">
                    {i + 1}
                    {slide.note.replace(/<[^>]*>/g, "").trim() && " ·"}
                  </span>
                </button>
              ))}
            </div>
          </aside>
        )}

        <div className="min-w-0 flex-1">
          <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
            <RichTextEditor
              value={note.content}
              onChange={(html) => scheduleSave({ ...latest.current!, content: html })}
              placeholder="Type your lecture notes here… Select text to get a quick format bar, or press Tab to indent."
              full
              stickyToolbar
              wordCount
              minHeightClass="min-h-[45vh]"
              maxHeightClass="max-h-none"
              onUploadImage={uploadInlineImage}
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
                    ref={(el) => {
                      if (el) slideRefs.current.set(slide.id, el);
                      else slideRefs.current.delete(slide.id);
                    }}
                    className="scroll-mt-20 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
                      <span className="text-xs font-semibold text-slate-400">
                        Slide {i + 1}
                      </span>
                      <div className="flex gap-1">
                        <SlideToOcclusionButton
                          decks={decks}
                          slideNumber={i + 1}
                          onPick={(deckId) => slideToOcclusion(slide, i, deckId)}
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
                        placeholder={`Notes for slide ${i + 1}…`}
                        full
                        minHeightClass="min-h-16"
                        onUploadImage={uploadInlineImage}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

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
            const { url } = await uploadDeckMedia(
              user!.uid,
              target.id,
              file.name,
              bytes
            );
            return url;
          }}
        />
      )}
    </Layout>
  );
}

function SaveIndicator({
  state,
  savedAt,
}: {
  state: SaveState;
  savedAt: Date | null;
}) {
  if (state === "offline") {
    return (
      <span
        className="flex items-center gap-1.5 text-xs font-medium text-amber-600"
        title="You're offline. Your typing is saved on this device and syncs automatically when you reconnect."
      >
        <CloudOff size={13} /> Offline — saved locally, will sync
      </span>
    );
  }
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
        <Loader2 size={13} className="animate-spin" /> Saving…
      </span>
    );
  }
  if (state === "dirty") {
    return <span className="text-xs font-medium text-slate-400">Editing…</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
      <Check size={13} />
      {savedAt
        ? `Saved ${savedAt.toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}`
        : "Saved"}
    </span>
  );
}

function SlideToOcclusionButton({
  decks,
  slideNumber,
  onPick,
}: {
  decks: Deck[];
  slideNumber: number;
  onPick: (deckId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        title={`Open slide ${slideNumber} in the occlusion editor — draw masks, save to a deck`}
      >
        <ScanEye size={13} /> Make occlusion
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-20 max-h-64 w-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            <p className="border-b border-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-400">
              Slide {slideNumber} → which deck?
            </p>
            {decks.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-400">
                No decks yet — create one first.
              </p>
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
        </>
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
      alert(
        "Select the part to hide and press the [ ]+ button (or ⌘⇧C) to add a {{c1::…}} blank."
      );
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
            full
            placeholder="Your selected text — now hide the answer with [ ]+ (⌘⇧C)"
            minHeightClass="min-h-28"
            onUploadImage={uploadImage}
            autoFocus
          />
        ) : (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">
                Front
              </label>
              <RichTextEditor
                value={front}
                onChange={setFront}
                placeholder="Question"
                onUploadImage={uploadImage}
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">
                Back
              </label>
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
