import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  FilePlus2,
  Loader2,
  RefreshCw,
  Star,
  ScanEye,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Layout } from "../components/Layout";
import { RichText } from "../components/RichText";
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
import {
  clearDraft,
  draftIsUnsaved,
  loadDraft,
  saveDraft,
} from "../lib/noteDrafts";
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

/** How long after you stop typing the note goes to Firestore. */
const SAVE_DEBOUNCE_MS = 1200;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;
/** How long to wait for the server before saying so and retrying. */
const PERSIST_TIMEOUT_MS = 8000;

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
  const [slideTab, setSlideTab] = useState<"all" | "outline" | "starred">("all");
  const [online, setOnline] = useState(navigator.onLine);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Note | null>(null);
  const savingRef = useRef(false);
  const retryDelay = useRef(RETRY_BASE_MS);
  const saveStateRef = useRef<SaveState>("saved");
  /**
   * Always the current flush. Retries and the loader reach the save through
   * this rather than closing over it: flushNow and a separate retry helper
   * referring to each other would each capture the other's first version, and
   * quietly keep using a stale one once the note or user changed.
   */
  const flushRef = useRef<() => Promise<void>>(async () => {});
  /** localStorage itself refused — the one case we can't quietly absorb */
  const [draftFailed, setDraftFailed] = useState(false);
  const [recovered, setRecovered] = useState(false);

  useEffect(() => {
    if (!user || !noteId) return;
    getNote(user.uid, noteId)
      .then((n) => {
        if (!n) {
          navigate("/notes");
          return;
        }
        // A draft newer than the stored note means the last session ended
        // before its save landed — a closed tab, a crash, a dead connection.
        const draft = loadDraft(noteId);
        if (draft && draftIsUnsaved(draft, n)) {
          const recovered: Note = {
            ...n,
            title: draft.title,
            className: draft.className,
            content: draft.content,
            slides: draft.slides,
          };
          setNote(recovered);
          latest.current = recovered;
          setRecovered(true);
          setSaveState("dirty");
          // Get it to the server now rather than waiting for a keystroke.
          saveTimer.current = setTimeout(() => void flushRef.current(), 0);
          return;
        }
        if (draft) clearDraft(noteId);
        setNote(n);
        latest.current = n;
      })
      .catch(() => {
        // Couldn't reach the note. If there's a draft, it is the only copy
        // of that work, so show it rather than an empty editor.
        const draft = loadDraft(noteId);
        if (!draft) return;
        const offlineNote: Note = {
          id: noteId,
          title: draft.title,
          className: draft.className,
          content: draft.content,
          slides: draft.slides,
          cardsMade: 0,
          createdAt: draft.savedAt,
          updatedAt: draft.savedAt,
        };
        setNote(offlineNote);
        latest.current = offlineNote;
        setRecovered(true);
        setSaveState("offline");
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
      await updateNote(user.uid, noteId, {
        title: n.title,
        className: n.className,
        content: n.content,
        slides: n.slides,
      });
    },
    [user, noteId]
  );

  /**
   * Pushes the note to Firestore and, once that is confirmed, drops the local
   * draft. A failure schedules a retry rather than waiting for the next
   * keystroke — someone who types a paragraph, loses signal and walks away
   * would otherwise never have it saved at all.
   */
  function retryIn(delay: number) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushRef.current(), delay);
  }

  const flushNow = useCallback(async (): Promise<void> => {
    if (!latest.current || !noteId) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (savingRef.current) return; // one in flight; it re-checks on the way out
    const attempt = latest.current;
    savingRef.current = true;
    setSaveState("saving");
    try {
      // Firestore's write promise only settles once the *server* has the
      // change, so offline it never settles at all. Capping the wait keeps
      // the indicator honest; the write itself carries on in the background
      // and the draft simply stays until a later attempt is confirmed.
      await Promise.race([
        persist(attempt),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("save timed out")), PERSIST_TIMEOUT_MS)
        ),
      ]);
      retryDelay.current = RETRY_BASE_MS;
      setSavedAt(new Date());
      if (latest.current === attempt) {
        // Nothing new since: this note really is on the server, so the local
        // copy has done its job.
        clearDraft(noteId);
        setSaveState(navigator.onLine ? "saved" : "offline");
      } else {
        // More was typed while that was in flight. The draft already holds it
        // and must not be cleared — it is the only copy of the newer text.
        savingRef.current = false;
        retryIn(0);
        return;
      }
    } catch {
      // Failed or timed out. The draft stays put, which is the whole point.
      setSaveState(navigator.onLine ? "dirty" : "offline");
      retryIn(retryDelay.current);
      retryDelay.current = Math.min(retryDelay.current * 2, RETRY_MAX_MS);
    } finally {
      savingRef.current = false;
    }
  }, [persist, noteId]);

  useEffect(() => {
    flushRef.current = flushNow;
  }, [flushNow]);

  /**
   * Every edit goes to localStorage on this tick, then to Firestore about a
   * second later. The synchronous half is what survives a tab being closed,
   * a crash, or a browser that never runs our unload handler.
   */
  const scheduleSave = useCallback(
    (updated: Note) => {
      latest.current = updated;
      setNote(updated);
      if (noteId && !saveDraft(noteId, updated)) setDraftFailed(true);
      else setDraftFailed(false);
      setSaveState("dirty");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flushRef.current(), SAVE_DEBOUNCE_MS);
    },
    [noteId]
  );

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  // Coming back online is the moment a failed save is most likely to work.
  useEffect(() => {
    function retryOnline() {
      setOnline(true);
      if (latest.current) retryIn(0);
    }
    window.addEventListener("online", retryOnline);
    return () => window.removeEventListener("online", retryOnline);
  }, []);

  // Leaving the page: save what we can, and say so if it might not land.
  useEffect(() => {
    function onHide() {
      // Synchronous, so it completes even if the page is killed straight
      // after. The Firestore write is started too but may not finish.
      if (noteId && latest.current) saveDraft(noteId, latest.current);
      if (saveTimer.current && latest.current) void flushRef.current();
    }
    function onBeforeUnload(e: BeforeUnloadEvent) {
      onHide();
      if (saveStateRef.current === "dirty" || saveStateRef.current === "saving") {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") onHide();
    });
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [noteId]);

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

  /**
   * Everything flagged for a second look: whole slides, plus every phrase
   * highlighted inline anywhere in the note. This is the pre-exam view — the
   * point of marking things is being able to pull just those back up.
   */
  const starred = useMemo(() => {
    const marks = (html: string) =>
      [...html.matchAll(/<mark class="starred">([\s\S]*?)<\/mark>/g)]
        .map((m) => m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim())
        .filter(Boolean);
    const out: {
      key: string;
      text: string;
      slide: number | null;
      whole: boolean;
    }[] = [];
    for (const text of marks(note?.content ?? "")) {
      out.push({ key: `c-${out.length}`, text, slide: null, whole: false });
    }
    (note?.slides ?? []).forEach((slide, i) => {
      if (slide.important) {
        const first =
          slide.note.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        out.push({
          key: `s-${slide.id}`,
          text: first || "(no notes yet)",
          slide: i,
          whole: true,
        });
      }
      for (const text of marks(slide.note)) {
        out.push({ key: `s-${slide.id}-${out.length}`, text, slide: i, whole: false });
      }
    });
    return out;
  }, [note]);
  const starredCount = starred.length;

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
    <Layout wide>
      <div className="mb-2 flex items-center justify-between gap-3">
        <button
          onClick={() => navigate("/notes")}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft size={15} /> All notes
        </button>
        <div className="flex items-center gap-3">
          {recovered && (
            <span
              className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
              title="This browser had newer notes than the server did — the last save hadn't landed. They've been put back and are saving now."
            >
              <RefreshCw size={12} /> Restored unsaved notes
            </span>
          )}
          {draftFailed && (
            <span
              className="flex items-center gap-1.5 rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-700"
              title="This browser refused to store a local copy (private browsing, or storage full). Your notes still save to the server, but there's no offline backup — copy anything important elsewhere."
            >
              <AlertTriangle size={12} /> No local backup
            </span>
          )}
          <SaveIndicator state={effectiveSave} savedAt={savedAt} />
        </div>
      </div>

      {/* One line: title, class, and the actions — the page needs its height
          for the slide and the writing, not for three rows of chrome. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={note.title}
          onChange={(e) => scheduleSave({ ...latest.current!, title: e.target.value })}
          placeholder="Lecture title"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-bold text-slate-900 outline-none focus:border-slate-300"
        />
        <input
          value={note.className}
          onChange={(e) =>
            scheduleSave({ ...latest.current!, className: e.target.value })
          }
          placeholder="Class"
          className="w-32 rounded-lg border border-slate-300 px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
        />
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
          className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
          title="Highlight text in your notes, then click to make a flashcard from it"
        >
          <Scissors size={13} /> Make card
        </button>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
          {slideProgress ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <FilePlus2 size={13} />
          )}
          <span className="max-w-[14rem] truncate">
            {slideProgress ?? (note.slides.length > 0 ? "Add slides" : "Add slides (PDF or PPTX)")}
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
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            <RefreshCw size={13} />
            <span>Replace</span>
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
        A landscape slide leaves most of its column empty, so the lecture-wide
        notes sit underneath it rather than beside. The slide's own notes stay
        in their own column, and everything typed against a slide also shows
        up in the lecture notes as a labelled block — so the left column reads
        as one running record of the lecture.
      */}
      <div className="grid h-[calc(100vh-9.5rem)] min-h-[34rem] grid-cols-1 gap-3 lg:grid-cols-[minmax(0,46fr)_minmax(0,32fr)_minmax(0,22fr)]">
        {/* ---------- slide, then the lecture as a whole ---------- */}
        <div className="order-1 flex min-h-0 flex-col gap-3">
          {note.slides.length > 0 ? (
            <section
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  setActiveSlide((i) =>
                    Math.max(
                      0,
                      Math.min(note.slides.length - 1, i + (e.key === "ArrowRight" ? 1 : -1))
                    )
                  );
                }
              }}
              className="relative flex shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-indigo-50/50 outline-none focus:border-indigo-300"
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold tabular-nums text-slate-600 shadow-sm">
                  {slideIndex + 1}
                  <span className="font-medium text-slate-400">/{note.slides.length}</span>
                </span>
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-1 py-0.5 shadow-sm">
                  <button
                    onClick={() =>
                      updateSlide(note.slides[slideIndex].id, {
                        important: !note.slides[slideIndex].important,
                      })
                    }
                    title={
                      note.slides[slideIndex].important
                        ? "Important — remove the flag"
                        : "Flag this slide as important"
                    }
                    className={`rounded-md p-1.5 transition ${
                      note.slides[slideIndex].important
                        ? "text-amber-500"
                        : "text-slate-300 hover:text-amber-500"
                    }`}
                  >
                    <Star
                      size={15}
                      fill={note.slides[slideIndex].important ? "currentColor" : "none"}
                    />
                  </button>
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const html = captureSelection();
                      if (!html) {
                        alert("Highlight text in the notes first, then press this.");
                        return;
                      }
                      setCardPrefill(html);
                    }}
                    title="Make a card from the highlighted notes"
                    className="rounded-md p-1.5 text-slate-400 transition hover:text-indigo-600"
                  >
                    <Scissors size={15} />
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
                    className="rounded-md p-1.5 text-slate-300 transition hover:text-red-500"
                    title="Remove slide"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              <div className="relative flex items-center justify-center px-10 pb-3">
                <img
                  src={note.slides[slideIndex].imageUrl}
                  alt={`Slide ${slideIndex + 1}`}
                  // Sized to the slide, not to the column: a 16:9 deck should
                  // not stretch a panel to fill height it doesn't need.
                  className="max-h-[38vh] w-full rounded-xl border border-slate-200 bg-white object-contain shadow-sm"
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
            </section>
          ) : (
            <section className="flex shrink-0 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <FilePlus2 size={22} className="mb-2 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">No slides yet</p>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
                Add a PDF or PowerPoint above and each slide becomes its own
                page to write against.
              </p>
            </section>
          )}

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <p className="shrink-0 border-b border-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Lecture notes
            </p>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {/* Typed here rather than against a slide — indigo, so it reads
                  as the through-line of the lecture. */}
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-1">
                <RichTextEditor
                  value={note.content}
                  onChange={(html) =>
                    scheduleSave({ ...latest.current!, content: html })
                  }
                  placeholder="Notes for the lecture as a whole…"
                  full
                  onUploadImage={uploadInlineImage}
                  minHeightClass="min-h-[7rem]"
                  maxHeightClass="max-h-none"
                  contentClass="px-4 py-3 text-[15px] leading-[1.6] text-indigo-950"
                />
              </div>

              {/* Everything written against a slide, in slide order. */}
              {note.slides.map((slide, i) =>
                slide.note.replace(/<[^>]*>/g, "").trim() ? (
                  // A div, not a button: these mirror the note's own markup,
                  // which can contain links and checkboxes — and a button
                  // cannot legally contain either.
                  <div
                    key={slide.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveSlide(i)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActiveSlide(i);
                      }
                    }}
                    title={`Go to slide ${i + 1}`}
                    className={`block w-full cursor-pointer rounded-xl border px-3 py-2 text-left transition hover:border-indigo-300 ${
                      i === slideIndex
                        ? "border-indigo-300 bg-indigo-50/30"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <span className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                      Slide {i + 1}
                      {slide.important && (
                        <Star size={10} fill="currentColor" className="text-amber-500" />
                      )}
                    </span>
                    <RichText
                      html={slide.note}
                      className="text-[14px] leading-[1.55] text-slate-700"
                    />
                  </div>
                ) : null
              )}
            </div>
          </section>
        </div>

        {/* ---------- this slide ---------- */}
        <section className="order-2 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 border-t-2 border-t-indigo-500 bg-white shadow-md">
          <p className="shrink-0 border-b border-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            {note.slides.length > 0 ? `Slide ${slideIndex + 1} notes` : "Slide notes"}
          </p>
          <div className="min-h-0 flex-1 p-2">
            {note.slides.length > 0 ? (
              <RichTextEditor
                key={note.slides[slideIndex].id}
                value={note.slides[slideIndex].note}
                onChange={(html) => updateSlide(note.slides[slideIndex].id, { note: html })}
                placeholder={`What was said about slide ${slideIndex + 1}…`}
                full
                fill
                onUploadImage={uploadInlineImage}
                contentClass="px-5 py-4 text-[16px] leading-[1.65]"
              />
            ) : (
              <p className="px-4 py-8 text-center text-xs text-slate-400">
                Add slides and this is where you'll write about each one.
              </p>
            )}
          </div>
        </section>

        {/* ---------- getting anywhere else ---------- */}
        <aside className="order-3 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-0.5 border-b border-slate-100 px-1.5 py-1.5">
            {(
              [
                ["all", "Slides"],
                ["outline", "Outline"],
                ["starred", starredCount ? `★ ${starredCount}` : "★"],
              ] as [typeof slideTab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setSlideTab(id)}
                className={`flex-1 rounded-lg px-1.5 py-1.5 text-[11px] font-semibold transition ${
                  slideTab === id
                    ? id === "starred"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-indigo-50 text-indigo-700"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {slideTab === "starred" ? (
              starred.length === 0 ? (
                <p className="px-3 py-8 text-center text-[11px] leading-relaxed text-slate-400">
                  Nothing flagged yet. Use the{" "}
                  <Star size={10} className="inline text-amber-400" /> on a slide,
                  or highlight a phrase and press the star in the toolbar.
                </p>
              ) : (
                starred.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => item.slide !== null && setActiveSlide(item.slide)}
                    className="flex w-full items-start gap-1.5 border-b border-amber-50 px-2.5 py-2 text-left last:border-b-0 hover:bg-amber-50/60"
                  >
                    <Star
                      size={11}
                      fill={item.whole ? "currentColor" : "none"}
                      className="mt-0.5 shrink-0 text-amber-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] leading-snug text-slate-700">
                        {item.text.length > 90 ? item.text.slice(0, 90) + "…" : item.text}
                      </span>
                      <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-amber-600/70">
                        {item.slide === null
                          ? "Lecture"
                          : item.whole
                            ? `Slide ${item.slide + 1} — whole`
                            : `Slide ${item.slide + 1}`}
                      </span>
                    </span>
                  </button>
                ))
              )
            ) : slideTab === "outline" ? (
              note.slides.map((slide, i) => {
                const line = slide.note.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
                return (
                  <button
                    key={slide.id}
                    onClick={() => setActiveSlide(i)}
                    className={`flex w-full items-baseline gap-2 border-b border-slate-50 px-2.5 py-2 text-left text-[11px] last:border-b-0 hover:bg-slate-50 ${
                      i === slideIndex ? "bg-indigo-50/60" : ""
                    }`}
                  >
                    <span className="w-5 shrink-0 font-bold text-slate-400">{i + 1}</span>
                    <span className={line ? "truncate text-slate-700" : "italic text-slate-300"}>
                      {line || "—"}
                    </span>
                    {slide.important && (
                      <Star size={10} fill="currentColor" className="ml-auto shrink-0 text-amber-500" />
                    )}
                  </button>
                );
              })
            ) : (
              <div className="grid grid-cols-2 gap-1.5 p-2">
                {note.slides.map((slide, i) => (
                  <button
                    key={slide.id}
                    onClick={() => setActiveSlide(i)}
                    className={`group relative block overflow-hidden rounded-lg border transition ${
                      i === slideIndex
                        ? "border-indigo-400 ring-2 ring-indigo-100"
                        : slide.important
                          ? "border-amber-300"
                          : "border-slate-200 hover:border-indigo-300"
                    }`}
                    title={`Go to slide ${i + 1}`}
                  >
                    {slide.important && (
                      <Star
                        size={11}
                        fill="currentColor"
                        className="absolute right-1 top-1 text-amber-500 drop-shadow"
                      />
                    )}
                    <img src={slide.imageUrl} alt="" loading="lazy" className="block w-full" />
                    <span className="block bg-slate-50 py-0.5 text-[10px] font-semibold text-slate-500 group-hover:bg-indigo-50 group-hover:text-indigo-600">
                      {i + 1}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
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
    return (
      <span
        className="text-xs font-medium text-slate-400"
        title="Typed and kept on this device. Saving to the server shortly."
      >
        Editing…
      </span>
    );
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
