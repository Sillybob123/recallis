import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  FilePlus2,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ScanEye,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Layout } from "../components/Layout";
import { RichTextEditor } from "../components/RichTextEditor";
import {
  createCard,
  createOcclusionSheet,
  ensureDeckPath,
  getNote,
  updateNote,
  uploadDeckMedia,
  uploadNoteSlide,
  deleteNoteSlideFiles,
  watchDecks,
} from "../lib/firestore";
import type { CardData, Deck, Note, NoteSlide } from "../types";
import {
  findDeckByPath,
  joinDeckPath,
  normalizeDeckPath,
  splitDeckPath,
} from "../lib/deckPath";
import { uid } from "../lib/uid";
import { htmlToText } from "../lib/text";

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
  /** which slide the right-hand panel is showing */
  const [activeSlide, setActiveSlide] = useState(0);
  const [slideTab, setSlideTab] = useState<"note" | "all" | "outline">("note");
  const [online, setOnline] = useState(navigator.onLine);

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

  async function handleSlideFile(file: File, replace = false) {
    if (!user || !noteId || !latest.current) return;
    if (replace && latest.current.slides.length > 0) {
      if (
        !confirm(
          `Replace all ${latest.current.slides.length} slides with this file?\n\n` +
            "Notes you wrote under the old slides are removed with them. " +
            "Cards and occlusion sheets you already made are not affected."
        )
      ) {
        return;
      }
    }
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
          id: uid(),
          imagePath: path,
          imageUrl: url,
          note: "",
        });
      }
      const old = replace ? latest.current.slides : [];
      scheduleSave({
        ...latest.current,
        slides: replace ? newSlides : [...latest.current.slides, ...newSlides],
      });
      if (old.length > 0) {
        // Free the replaced images rather than leaving them paid-for orphans.
        deleteNoteSlideFiles(old.map((sl) => sl.imagePath)).catch(() => {});
      }
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
    const remaining = latest.current.slides.filter((s) => s.id !== id);
    setActiveSlide((i) => Math.max(0, Math.min(i, remaining.length - 1)));
    scheduleSave({ ...latest.current, slides: remaining });
  }

  /**
   * Turn one specific slide into an occlusion sheet.
   *
   * The slide already lives in Storage, so the sheet simply points at the same
   * file (`linkedImage`) instead of downloading and re-uploading the bytes.
   * That avoids the cross-origin read that made this fail with
   * `storage/retry-limit-exceeded`, is instant, and doesn't double storage.
   * Dimensions come from an <img>, which needs no CORS permission.
   */
  async function slideToOcclusion(slide: NoteSlide, index: number, deckId: string) {
    if (!user || !latest.current) return;
    setSlideProgress(`Preparing slide ${index + 1}…`);
    try {
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(new Error("The slide image couldn't be loaded."));
        img.src = slide.imageUrl;
      });

      const sheetId = await createOcclusionSheet(user.uid, deckId, {
        title: `${latest.current.title} — slide ${index + 1}`,
        imagePath: slide.imagePath,
        imageUrl: slide.imageUrl,
        imageWidth: dims.w,
        imageHeight: dims.h,
        shapes: [],
        linkedImage: true,
      });

      // Make sure nothing typed is lost before we navigate away.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await persist(latest.current).catch(() => {});
      const back = encodeURIComponent(`/notes/${noteId}#slide-${slide.id}`);
      navigate(`/deck/${deckId}/occlusion/${sheetId}/edit?returnTo=${back}`);
    } catch (err) {
      alert("Couldn't open that slide for occlusion: " + (err as Error).message);
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

  // Coming back from the occlusion editor lands on #slide-<id>; select it
  // once the slides have rendered.
  useEffect(() => {
    if (!note) return;
    const hash = window.location.hash;
    if (!hash.startsWith("#slide-")) return;
    const id = hash.slice("#slide-".length);
    // One slide shows at a time now, so coming back from an occlusion means
    // selecting that slide rather than scrolling the page to it.
    const index = note.slides.findIndex((sl) => sl.id === id);
    if (index >= 0) setActiveSlide(index);
  }, [note]);

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

  // Slides can be replaced with a shorter deck while a later one is selected,
  // so the index is clamped on the way out rather than trusted.
  const slideIndex = Math.max(0, Math.min(activeSlide, note.slides.length - 1));

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
            onClick={() => setSlideTab((t) => (t === "all" ? "note" : "all"))}
            title={slideTab === "all" ? "Back to the current slide" : "Show every slide"}
            className="rounded-lg border border-slate-300 bg-white p-2 text-slate-500 hover:bg-slate-50"
          >
            {slideTab === "all" ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
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
          <span className="truncate">
            {slideProgress ??
              (note.slides.length > 0
                ? "Add more slides"
                : "Add lecture slides (PDF or PPTX)")}
          </span>
          <input
            type="file"
            accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
            disabled={Boolean(slideProgress)}
            onChange={(e) => e.target.files?.[0] && handleSlideFile(e.target.files[0])}
          />
        </label>
        {note.slides.length > 0 && (
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <RefreshCw size={14} />
            <span className="truncate">Replace slides</span>
            <input
              type="file"
              accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              className="hidden"
              disabled={Boolean(slideProgress)}
              onChange={(e) =>
                e.target.files?.[0] && handleSlideFile(e.target.files[0], true)
              }
            />
          </label>
        )}
      </div>

      {/*
        Split view: notes on the left, one slide at a time on the right. The
        old layout stacked every slide down the page, so following a lecture
        meant scrolling past slides you weren't writing about.
      */}
      <div
        className={`grid gap-5 ${
          note.slides.length > 0 ? "lg:grid-cols-[1.3fr_1fr]" : ""
        }`}
      >
        <div className="order-2 min-w-0 lg:order-1">
          <div className="rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
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
        </div>

        {note.slides.length > 0 && (
          <div className="order-1 min-w-0 lg:order-2">
            <div className="lg:sticky lg:top-[70px]">
              <div className="mb-2 flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 text-xs font-semibold shadow-sm">
                {(
                  [
                    ["note", "Slide note"],
                    ["all", "All slides"],
                    ["outline", "Outline"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setSlideTab(id)}
                    className={`flex-1 rounded-lg px-2 py-1.5 transition ${
                      slideTab === id
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {slideTab === "all" ? (
                <div className="max-h-[calc(100vh-160px)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
                    {note.slides.map((slide, i) => (
                      <button
                        key={slide.id}
                        onClick={() => {
                          setActiveSlide(i);
                          setSlideTab("note");
                        }}
                        className={`group block overflow-hidden rounded-lg border transition ${
                          i === slideIndex
                            ? "border-indigo-400 ring-2 ring-indigo-100"
                            : "border-slate-200 hover:border-indigo-300"
                        }`}
                        title={`Go to slide ${i + 1}`}
                      >
                        <img src={slide.imageUrl} alt="" loading="lazy" className="block w-full" />
                        <span className="block bg-slate-50 py-0.5 text-[10px] font-semibold text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600">
                          {i + 1}
                          {slide.note.replace(/<[^>]*>/g, "").trim() && " ·"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : slideTab === "outline" ? (
                <div className="max-h-[calc(100vh-160px)] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                  {note.slides.map((slide, i) => {
                    const line = slide.note.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
                    return (
                      <button
                        key={slide.id}
                        onClick={() => {
                          setActiveSlide(i);
                          setSlideTab("note");
                        }}
                        className={`flex w-full items-baseline gap-2 border-b border-slate-50 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-slate-50 ${
                          i === slideIndex ? "bg-indigo-50/60" : ""
                        }`}
                      >
                        <span className="w-6 shrink-0 font-bold text-slate-400">{i + 1}</span>
                        <span className={line ? "truncate text-slate-700" : "italic text-slate-300"}>
                          {line || "no notes yet"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <>
                  {/* Arrow keys move between slides once the panel is focused. */}
                  <div
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                        e.preventDefault();
                        setActiveSlide((i) =>
                          Math.max(
                            0,
                            Math.min(
                              note.slides.length - 1,
                              i + (e.key === "ArrowRight" ? 1 : -1)
                            )
                          )
                        );
                      }
                    }}
                    className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm outline-none focus:border-indigo-300"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5">
                      <span className="text-xs font-semibold text-slate-400">
                        Slide {slideIndex + 1} of {note.slides.length}
                      </span>
                      <div className="flex gap-1">
                        <button
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            const html = captureSelection();
                            if (!html) {
                              alert(
                                "Highlight the text in this slide's notes first, then press this."
                              );
                              return;
                            }
                            setCardPrefill(html);
                          }}
                          className="flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
                          title="Make a card from the text you've highlighted in this slide's notes"
                        >
                          <Scissors size={13} /> Make card
                        </button>
                        <SlideToOcclusionButton
                          decks={decks}
                          slideNumber={slideIndex + 1}
                          onPick={(deckId) =>
                            slideToOcclusion(note.slides[slideIndex], slideIndex, deckId)
                          }
                        />
                        <button
                          onClick={() => removeSlide(note.slides[slideIndex].id)}
                          className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
                          title="Remove slide"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="relative bg-slate-50">
                      <img
                        src={note.slides[slideIndex].imageUrl}
                        alt={`Slide ${slideIndex + 1}`}
                        className="block max-h-[46vh] w-full object-contain"
                      />
                      <SlideArrow
                        side="left"
                        disabled={slideIndex === 0}
                        onClick={() => setActiveSlide((i) => Math.max(0, i - 1))}
                      />
                      <SlideArrow
                        side="right"
                        disabled={slideIndex >= note.slides.length - 1}
                        onClick={() =>
                          setActiveSlide((i) => Math.min(note.slides.length - 1, i + 1))
                        }
                      />
                    </div>
                  </div>

                  <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
                    <RichTextEditor
                      key={note.slides[slideIndex].id}
                      value={note.slides[slideIndex].note}
                      onChange={(html) =>
                        updateSlide(note.slides[slideIndex].id, { note: html })
                      }
                      placeholder={`Notes for slide ${slideIndex + 1}…`}
                      full
                      minHeightClass="min-h-24"
                      maxHeightClass="max-h-[28vh]"
                      onUploadImage={uploadInlineImage}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {cardPrefill !== null && (
        <MakeCardModal
          decks={decks}
          suggestedPath={suggestedDeckPath(note)}
          initialSubdeck={note.lastSubdeck ?? ""}
          prefillHtml={cardPrefill}
          onClose={() => setCardPrefill(null)}
          onSave={async (deckPath, data, subdeck) => {
            const deckId = await ensureDeckPath(user!.uid, deckPath, decks);
            await createCard(user!.uid, deckId, data);
            if ((subdeck ?? "") !== (latest.current?.lastSubdeck ?? "")) {
              const updated = { ...latest.current!, lastSubdeck: subdeck ?? "" };
              latest.current = updated;
              setNote(updated);
              updateNote(user!.uid, noteId!, { lastSubdeck: subdeck ?? "" }).catch(
                () => {}
              );
            }
            if (latest.current) {
              const updated = {
                ...latest.current,
                cardsMade: (latest.current.cardsMade ?? 0) + 1,
              };
              latest.current = updated;
              setNote(updated);
              updateNote(user!.uid, noteId!, {
                cardsMade: updated.cardsMade,
              }).catch(() => {});
            }
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

/** A chevron pinned in a bottom corner of the slide, as a page-turn. */
function SlideArrow({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={side === "left" ? "Previous slide" : "Next slide"}
      aria-label={side === "left" ? "Previous slide" : "Next slide"}
      className={`absolute bottom-3 ${
        side === "left" ? "left-3" : "right-3"
      } rounded-full border border-slate-200 bg-white/80 p-2 text-slate-600 shadow-sm backdrop-blur transition enabled:hover:bg-white enabled:hover:text-slate-900 disabled:opacity-0`}
    >
      {side === "left" ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
    </button>
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

/** Cards from a lecture belong in a deck named after it: Class::Lecture. */
function suggestedDeckPath(note: Note): string {
  return joinDeckPath([note.className.trim(), note.title.trim()]);
}

function MakeCardModal({
  decks,
  suggestedPath,
  initialSubdeck,
  prefillHtml,
  onSave,
  onClose,
  uploadImage,
}: {
  decks: Deck[];
  suggestedPath: string;
  initialSubdeck: string;
  prefillHtml: string;
  onSave: (deckPath: string, data: CardData, subdeck?: string) => Promise<void>;
  onClose: () => void;
  uploadImage: (file: File) => Promise<string>;
}) {
  const [deckPath, setDeckPath] = useState(suggestedPath);
  // Lecture notes usually stay on one topic for a stretch, so the last
  // subdeck you filed into ("Thorax") is the best first guess — switch it
  // when the lecture moves on ("Thigh").
  const [subdeck, setSubdeck] = useState(initialSubdeck);

  /** Subdecks that already exist under the lecture's deck. */
  const knownSubdecks = (() => {
    const base = normalizeDeckPath(deckPath).toLowerCase();
    if (!base) return [] as string[];
    const seen = new Set<string>();
    for (const d of decks) {
      const path = normalizeDeckPath(d.name);
      if (path.toLowerCase().startsWith(base + "::")) {
        const next = splitDeckPath(path.slice(base.length))[0];
        if (next) seen.add(next);
      }
    }
    if (initialSubdeck) seen.add(initialSubdeck);
    return [...seen].sort();
  })();
  const fullPath = joinDeckPath([
    ...splitDeckPath(deckPath),
    ...splitDeckPath(subdeck),
  ]);
  const existing = findDeckByPath(decks, fullPath);
  const [type, setType] = useState<"cloze" | "basic">("cloze");
  const [text, setText] = useState(prefillHtml);
  const [front, setFront] = useState(prefillHtml);
  const [back, setBack] = useState("");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[]>([]);

  const clozeCount = new Set(
    Array.from(text.matchAll(/\{\{c(\d+)::/g)).map((m) => m[1])
  ).size;

  function plain(html: string) {
    return htmlToText(html);
  }

  async function handleSave(keepOpen: boolean) {
    if (!fullPath) {
      alert("Give the card a deck — e.g. Anatomy::Lab 3.");
      return;
    }
    if (type === "cloze" && clozeCount === 0) {
      alert(
        "Select the part to hide and press the [ ]+ button (or \u2318\u21E7C) to add a {{c1::\u2026}} blank."
      );
      return;
    }
    if (type === "basic" && (!plain(front) || !plain(back))) {
      alert("A basic card needs both a front and a back.");
      return;
    }
    setBusy(true);
    try {
      await onSave(
        fullPath,
        type === "cloze"
          ? { type: "cloze", text, extra: plain(extra) ? extra : undefined }
          : { type: "basic", front, back },
        splitDeckPath(subdeck).join("::") || undefined
      );
      setAdded((prev) => [
        ...prev,
        plain(type === "cloze" ? text : front).slice(0, 70) || "card",
      ]);
      if (keepOpen) {
        setText("");
        setFront("");
        setBack("");
        setExtra("");
      } else {
        onClose();
      }
    } catch (err) {
      alert("Couldn't save that card: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="flex h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Make a card</h2>
            <p className="text-xs text-slate-500">
              Built from the text you selected in your notes.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* controls */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50 px-6 py-3">
          <label className="flex min-w-[15rem] flex-1 items-center gap-2 text-xs font-medium text-slate-600">
            Deck
            <input
              value={deckPath}
              onChange={(e) => setDeckPath(e.target.value)}
              list="deck-paths"
              placeholder="Anatomy::Lab 3"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-500"
            />
            <datalist id="deck-paths">
              {decks.map((d) => (
                <option key={d.id} value={normalizeDeckPath(d.name)} />
              ))}
            </datalist>
          </label>

          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
            Subdeck
            <input
              value={subdeck}
              onChange={(e) => setSubdeck(e.target.value)}
              placeholder="optional, e.g. Thorax"
              className="w-52 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-500"
            />
          </label>
          {(knownSubdecks.length > 0 || subdeck) && (
            <span className="flex w-full flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400">Quick pick:</span>
              {knownSubdecks.map((sd) => (
                <button
                  key={sd}
                  type="button"
                  onClick={() => setSubdeck(sd)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                    subdeck.trim().toLowerCase() === sd.toLowerCase()
                      ? "border-indigo-500 bg-indigo-100 text-indigo-800"
                      : "border-slate-200 bg-white text-slate-500 hover:border-indigo-300"
                  }`}
                >
                  {sd}
                </button>
              ))}
              {subdeck && (
                <button
                  type="button"
                  onClick={() => setSubdeck("")}
                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-400 hover:text-slate-600"
                  title="No subdeck — file straight into the lecture deck"
                >
                  none
                </button>
              )}
            </span>
          )}

          <div className="flex gap-1 rounded-lg bg-white p-1 text-sm ring-1 ring-slate-200">
            <button
              onClick={() => setType("cloze")}
              className={`rounded-md px-3 py-1 font-medium transition ${
                type === "cloze"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Cloze
            </button>
            <button
              onClick={() => setType("basic")}
              className={`rounded-md px-3 py-1 font-medium transition ${
                type === "basic"
                  ? "bg-indigo-600 text-white"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              Basic
            </button>
          </div>

          {type === "cloze" && (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                clozeCount > 0
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {clozeCount > 0
                ? `${clozeCount} blank${clozeCount === 1 ? "" : "s"} → ${clozeCount} card${clozeCount === 1 ? "" : "s"}`
                : "No blanks yet — select text, then press [ ]+"}
            </span>
          )}
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {type === "cloze" ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                  Text
                  <span className="ml-2 font-normal text-slate-400">
                    select what to hide, then [ ]+ (⌘⇧C) — [ ]= reuses the last
                    number so blanks share one card
                  </span>
                </label>
                <RichTextEditor
                  value={text}
                  onChange={setText}
                  cloze
                  full
                  placeholder="The heart has four chambers."
                  minHeightClass="min-h-[34vh]"
                  maxHeightClass="max-h-none"
                  onUploadImage={uploadImage}
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                  Extra
                  <span className="ml-2 font-normal text-slate-400">
                    optional — shown after you answer
                  </span>
                </label>
                <RichTextEditor
                  value={extra}
                  onChange={setExtra}
                  full
                  placeholder="Mnemonic, context, or the slide it came from"
                  minHeightClass="min-h-20"
                  onUploadImage={uploadImage}
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                  Front <span className="font-normal text-slate-400">(question)</span>
                </label>
                <RichTextEditor
                  value={front}
                  onChange={setFront}
                  full
                  placeholder="What does the Doyen retractor do?"
                  minHeightClass="min-h-[34vh]"
                  maxHeightClass="max-h-none"
                  onUploadImage={uploadImage}
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-600">
                  Back <span className="font-normal text-slate-400">(answer)</span>
                </label>
                <RichTextEditor
                  value={back}
                  onChange={setBack}
                  full
                  placeholder="Holds soft organs out of the way with a wide contact area."
                  minHeightClass="min-h-[34vh]"
                  maxHeightClass="max-h-none"
                  onUploadImage={uploadImage}
                />
              </div>
            </div>
          )}

          {added.length > 0 && (
            <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="mb-1.5 text-xs font-semibold text-emerald-800">
                Added this session ({added.length})
              </p>
              <ul className="space-y-0.5 text-xs text-emerald-700">
                {added.slice(-5).map((t, i) => (
                  <li key={i} className="flex gap-1.5">
                    <Check size={13} className="mt-0.5 shrink-0" />
                    <span className="truncate">{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex shrink-0 items-center gap-2 border-t border-slate-200 bg-white px-6 py-4">
          <p className="mr-auto text-xs text-slate-400">
            {fullPath ? (
              <>
                Saving to <b className="text-slate-600">{fullPath}</b>
                {!existing && " — this deck will be created"}
              </>
            ) : (
              "Choose a deck to save into."
            )}
          </p>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            {added.length ? "Done" : "Cancel"}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={busy}
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Add & make another"}
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={busy}
            className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Add card & close"}
          </button>
        </div>
      </div>
    </div>
  );
}
