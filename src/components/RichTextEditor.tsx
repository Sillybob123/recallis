import { useCallback, useEffect, useRef, useState } from "react";
import {
  caretOffset,
  EditorHistory,
  restoreCaret,
} from "../lib/editorHistory";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Brackets,
  CheckSquare,
  Eraser,
  Highlighter,
  Image as ImageIcon,
  Indent,
  Italic,
  Link2,
  List,
  ListOrdered,
  Outdent,
  Redo2,
  MoreHorizontal,
  Star,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Undo2,
} from "lucide-react";

const TEXT_COLORS = [
  "#0f172a",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#059669",
  "#2563eb",
  "#7c3aed",
  "#db2777",
];
const HILITE_COLORS = [
  "#fef08a",
  "#bbf7d0",
  "#bfdbfe",
  "#fbcfe8",
  "#fed7aa",
  "#e9d5ff",
];
const FONTS = [
  { label: "Sans", css: "'Inter', system-ui, sans-serif" },
  { label: "Serif", css: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", css: "'SF Mono', Menlo, Consolas, monospace" },
];
const SIZES = [12, 14, 16, 18, 20, 24, 30];
/** How long a pause ends one undo step and starts the next. */
const HISTORY_PAUSE_MS = 500;

/** execCommand fontSize only accepts 1–7, so map our px list onto that. */
const SIZE_TO_LEGACY: Record<number, string> = {
  12: "1",
  14: "2",
  16: "3",
  18: "4",
  20: "5",
  24: "6",
  30: "7",
};

const BLOCK_STYLES = [
  { label: "Normal text", tag: "div" },
  { label: "Heading 1", tag: "h1" },
  { label: "Heading 2", tag: "h2" },
  { label: "Heading 3", tag: "h3" },
  { label: "Quote", tag: "blockquote" },
];

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** show the cloze insert buttons (card editors) */
  cloze?: boolean;
  /** show block-style, font, alignment, indent, checklist, link controls */
  full?: boolean;
  /** keep the toolbar pinned while scrolling long documents */
  stickyToolbar?: boolean;
  /** show a live word/character count under the field */
  wordCount?: boolean;
  minHeightClass?: string;
  /** typography and padding of the writing area itself */
  contentClass?: string;
  /** stretch to the height of the parent instead of sizing to content */
  fill?: boolean;
  maxHeightClass?: string;
  onUploadImage?: (file: File) => Promise<string>;
  autoFocus?: boolean;
}

/**
 * Contenteditable rich-text field.
 * Shortcuts: ⌘/Ctrl+B/I/U and ⌘/Ctrl+Z/⇧Z are native; ⌘/Ctrl+K inserts a link,
 * ⌘/Ctrl+⇧+C a new cloze, ⌘/Ctrl+⇧+⌥+C a same-number cloze.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  cloze = false,
  full = false,
  stickyToolbar = false,
  wordCount = false,
  minHeightClass = "min-h-20",
  contentClass = "px-3 py-2 text-sm",
  fill = false,
  maxHeightClass = "max-h-64",
  onUploadImage,
  autoFocus,
}: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [colorOpen, setColorOpen] = useState<null | "fore" | "hilite">(null);
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const [bubble, setBubble] = useState<{ top: number; left: number } | null>(null);
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });
  /** Two fully-expanded toolbars on one page was the clutter. */
  const [moreTools, setMoreTools] = useState(false);
  /** whether the caret currently sits inside a flagged phrase */
  const [starActive, setStarActive] = useState(false);
  const [starHint, setStarHint] = useState(false);
  const history = useRef<EditorHistory | null>(null);
  const coalesceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composing = useRef(false);
  const recountRef = useRef<(() => void) | null>(null);

  // Set initial content once; afterwards the div owns its own DOM.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
    history.current = new EditorHistory({ html: value, caret: null });
    setUndoState({ canUndo: false, canRedo: false });
    if (autoFocus) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Typing is grouped into steps rather than recorded per keystroke — one
   * Ctrl+Z should take back a word or a burst, not a single letter. The
   * snapshot lands once you pause, or immediately for a discrete action like
   * a toolbar command or a paste.
   */
  const commitHistory = useCallback(() => {
    if (coalesceTimer.current) {
      clearTimeout(coalesceTimer.current);
      coalesceTimer.current = null;
    }
    const el = ref.current;
    if (!el || !history.current || composing.current) return;
    if (history.current.push({ html: el.innerHTML, caret: caretOffset(el) })) {
      setUndoState({
        canUndo: history.current.canUndo,
        canRedo: history.current.canRedo,
      });
    }
  }, []);

  const scheduleHistory = useCallback(() => {
    if (coalesceTimer.current) clearTimeout(coalesceTimer.current);
    coalesceTimer.current = setTimeout(commitHistory, HISTORY_PAUSE_MS);
  }, [commitHistory]);

  /** Puts a remembered state back on screen, caret and all. */
  const applySnapshot = useCallback(
    (snap: { html: string; caret: number | null } | null) => {
      const el = ref.current;
      if (!snap || !el) return;
      el.innerHTML = snap.html;
      el.focus();
      restoreCaret(el, snap.caret);
      // The parent has to hear about it, or an undo would never be saved.
      onChange(el.innerHTML);
      recountRef.current?.();
      setUndoState({
        canUndo: history.current?.canUndo ?? false,
        canRedo: history.current?.canRedo ?? false,
      });
    },
    [onChange]
  );

  const undo = useCallback(() => {
    // Whatever has been typed since the last step is itself a step, or
    // pressing undo straight after typing would appear to do nothing.
    commitHistory();
    if (ref.current) history.current?.amendCaret(caretOffset(ref.current));
    applySnapshot(history.current?.undo() ?? null);
  }, [applySnapshot, commitHistory]);

  const redo = useCallback(() => {
    applySnapshot(history.current?.redo() ?? null);
  }, [applySnapshot]);

  const recount = useCallback(() => {
    if (!wordCount || !ref.current) return;
    const text = ref.current.innerText.replace(/​/g, "").trim();
    setCounts({
      words: text ? text.split(/\s+/).length : 0,
      chars: text.length,
    });
  }, [wordCount]);

  useEffect(() => {
    recount();
  }, [recount]);

  useEffect(() => {
    recountRef.current = recount;
  }, [recount]);

  function emit() {
    if (ref.current) onChange(ref.current.innerHTML);
    recount();
    scheduleHistory();
  }

  function exec(cmd: string, val?: string) {
    // A formatting command is one deliberate action: record the state before
    // it so undo steps back over the whole thing, not half of it.
    commitHistory();
    ref.current?.focus();
    document.execCommand(cmd, false, val);
    if (ref.current) onChange(ref.current.innerHTML);
    recount();
    commitHistory();
  }

  /** Wraps the selection in {{cN::…}}. same=true reuses the highest number. */
  function insertCloze(same: boolean) {
    const el = ref.current;
    if (!el) return;
    el.focus();
    let max = 0;
    for (const m of el.innerHTML.matchAll(/\{\{c(\d+)::/g)) {
      max = Math.max(max, Number(m[1]));
    }
    const n = same ? Math.max(max, 1) : max + 1;
    const sel = window.getSelection();
    let inner = "";
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const div = document.createElement("div");
      div.appendChild(sel.getRangeAt(0).cloneContents());
      inner = div.innerHTML;
    }
    document.execCommand("insertHTML", false, `{{c${n}::${inner || "…"}}}`);
    emit();
  }

  /** The starred phrase the selection is inside, if any. */
  function starredAtCaret(): HTMLElement | null {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return null;
    const node = sel.anchorNode;
    const from =
      node?.nodeType === 1 ? (node as HTMLElement) : (node?.parentElement ?? null);
    const mark = from?.closest?.("mark.starred") ?? null;
    return mark && el.contains(mark) ? (mark as HTMLElement) : null;
  }

  /**
   * Marks the selection as important, as <mark class="starred"> so it stays
   * inline in the flow of the note. Clicking inside an existing highlight
   * removes it.
   */
  function toggleStarred() {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) {
      el?.focus();
      return;
    }
    const existing = starredAtCaret();
    // Nothing selected and not inside one: say so rather than doing nothing
    // silently, which reads as a broken button.
    if (!existing && sel.isCollapsed) {
      setStarHint(true);
      window.setTimeout(() => setStarHint(false), 2600);
      el.focus();
      return;
    }
    commitHistory();
    el.focus();
    if (existing) {
      // Unwrap: keep the words, drop the flag, and keep them selected so the
      // button can be pressed again to put it back.
      const host = existing.parentNode;
      const first = existing.firstChild;
      const last = existing.lastChild;
      while (existing.firstChild) host?.insertBefore(existing.firstChild, existing);
      host?.removeChild(existing);
      if (first && last) {
        const range = document.createRange();
        range.setStartBefore(first);
        range.setEndAfter(last);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } else {
      const holder = document.createElement("div");
      holder.appendChild(sel.getRangeAt(0).cloneContents());
      document.execCommand(
        "insertHTML",
        false,
        `<mark class="starred">${holder.innerHTML}</mark>`
      );
    }
    if (ref.current) onChange(ref.current.innerHTML);
    recount();
    commitHistory();
    setStarActive(Boolean(starredAtCaret()));
  }

  /** Checklist item — execCommand has no equivalent, so insert markup. */
  function insertChecklist() {
    ref.current?.focus();
    document.execCommand(
      "insertHTML",
      false,
      '<ul class="checklist"><li><input type="checkbox"> </li></ul>'
    );
    emit();
  }

  function insertLink() {
    const sel = window.getSelection();
    const hasSelection = sel && !sel.isCollapsed;
    const url = prompt("Link URL:", "https://");
    if (!url) return;
    ref.current?.focus();
    if (hasSelection) {
      document.execCommand("createLink", false, url);
    } else {
      document.execCommand(
        "insertHTML",
        false,
        `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`
      );
    }
    emit();
  }

  async function handleImageFile(f: File) {
    if (!onUploadImage) return;
    setUploading(true);
    try {
      const url = await onUploadImage(f);
      ref.current?.focus();
      document.execCommand("insertHTML", false, `<img src="${url}">`);
      emit();
    } catch (err) {
      alert("Image upload failed: " + (err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Paste an image straight from the clipboard (screenshot of a slide, etc.).
  function handlePaste(e: React.ClipboardEvent) {
    // Close the current typing step first, so one undo takes back the whole
    // paste rather than leaving half of it behind.
    commitHistory();
    const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
      i.type.startsWith("image/")
    );
    const f = item?.getAsFile();
    if (f && onUploadImage) {
      e.preventDefault();
      handleImageFile(f);
      return;
    }
    // The text lands after this handler returns; snapshot it as one step.
    setTimeout(commitHistory, 0);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    // Ours, not the browser's — its stack is empty for anything we inserted.
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
      return;
    }
    // A new line or a deletion ends a typing burst, so the next undo stops
    // at that boundary rather than swallowing the sentence before it.
    if (e.key === "Enter" || e.key === "Backspace" || e.key === "Delete") {
      commitHistory();
    }
    if (cloze && mod && e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      insertCloze(e.altKey);
    } else if (full && mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      insertLink();
    } else if (e.key === "Tab" && full) {
      e.preventDefault();
      exec(e.shiftKey ? "outdent" : "indent");
    }
  }

  // Floating format bar above the current selection.
  const updateBubble = useCallback(() => {
    const el = ref.current;
    const sel = window.getSelection();
    if (
      !el ||
      !sel ||
      sel.isCollapsed ||
      sel.rangeCount === 0 ||
      !el.contains(sel.anchorNode)
    ) {
      setBubble(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) {
      setBubble(null);
      return;
    }
    const host = el.getBoundingClientRect();
    setBubble({
      top: rect.top - host.top - 44,
      left: Math.max(rect.left - host.left + rect.width / 2, 90),
    });
  }, []);

  useEffect(() => {
    if (!full) return;
    function onSelectionChange() {
      updateBubble();
      setStarActive(Boolean(starredAtCaret()));
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [full, updateBubble]);

  function ToolButton({
    title,
    onClick,
    children,
    active,
    disabled,
  }: {
    title: string;
    onClick: () => void;
    children: React.ReactNode;
    active?: boolean;
    disabled?: boolean;
  }) {
    return (
      <button
        type="button"
        title={title}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()} // keep the selection alive
        onClick={onClick}
        className={`flex h-7 w-7 items-center justify-center rounded transition disabled:opacity-30 ${
          active
            ? "bg-slate-200 text-slate-900"
            : "text-slate-500 hover:bg-slate-100 enabled:hover:text-slate-800"
        }`}
      >
        {children}
      </button>
    );
  }

  const Divider = () => <span className="mx-1 h-4 w-px shrink-0 bg-slate-200" />;

  return (
    <div
      className={`rounded-lg border border-slate-300 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 ${
        fill ? "flex h-full min-h-0 flex-col" : ""
      }`}
    >
      <div
        className={`relative flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white px-1.5 py-1 ${
          stickyToolbar ? "sticky top-[57px] z-10 rounded-t-lg" : ""
        }`}
      >
        {/*
          What a lecture actually needs while typing stays out: undo, headings,
          emphasis, colour, lists and the star. Fonts, alignment, links and the
          rest go behind More, so a second editor on the page doesn't stack a
          second full toolbar.
        */}
        {full && (
          <>
            <ToolButton title="Undo (⌘Z)" disabled={!undoState.canUndo} onClick={undo}>
              <Undo2 size={14} />
            </ToolButton>
            <ToolButton title="Redo (⌘⇧Z)" disabled={!undoState.canRedo} onClick={redo}>
              <Redo2 size={14} />
            </ToolButton>
            <Divider />
            <select
              title="Heading or paragraph"
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                exec("formatBlock", `<${e.target.value}>`);
                e.target.selectedIndex = 0;
              }}
              className="h-7 rounded border border-slate-200 bg-white px-1 text-xs text-slate-600 outline-none hover:bg-slate-50"
            >
              <option value="">Style</option>
              {BLOCK_STYLES.map((b) => (
                <option key={b.tag} value={b.tag}>
                  {b.label}
                </option>
              ))}
            </select>
            <Divider />
          </>
        )}

        <ToolButton title="Bold (⌘B)" onClick={() => exec("bold")}>
          <Bold size={14} />
        </ToolButton>
        <ToolButton title="Italic (⌘I)" onClick={() => exec("italic")}>
          <Italic size={14} />
        </ToolButton>
        <ToolButton title="Underline (⌘U)" onClick={() => exec("underline")}>
          <Underline size={14} />
        </ToolButton>

        <Divider />
        <ToolButton
          title="Text colour"
          onClick={() => setColorOpen(colorOpen === "fore" ? null : "fore")}
        >
          <span className="border-b-2 border-red-500 text-xs font-bold">A</span>
        </ToolButton>
        <ToolButton
          title="Highlight"
          onClick={() => setColorOpen(colorOpen === "hilite" ? null : "hilite")}
        >
          <Highlighter size={14} />
        </ToolButton>
        {colorOpen && (
          <div className="absolute left-1/4 top-9 z-30 flex max-w-[220px] flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
            {(colorOpen === "fore" ? TEXT_COLORS : HILITE_COLORS).map((c) => (
              <button
                key={c}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  exec(colorOpen === "fore" ? "foreColor" : "hiliteColor", c);
                  setColorOpen(null);
                }}
                className="h-5 w-5 rounded-full border border-slate-200"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        )}

        <Divider />
        <ToolButton title="Bulleted list" onClick={() => exec("insertUnorderedList")}>
          <List size={14} />
        </ToolButton>
        <ToolButton title="Numbered list" onClick={() => exec("insertOrderedList")}>
          <ListOrdered size={14} />
        </ToolButton>

        <Divider />
        <ToolButton
          title={
            starActive
              ? "Flagged — press to remove"
              : "Select some words, then flag them as important"
          }
          active={starActive}
          onClick={toggleStarred}
        >
          <Star
            size={14}
            className="text-amber-500"
            fill={starActive ? "currentColor" : "none"}
          />
        </ToolButton>
        {starHint && (
          <span className="ml-1 whitespace-nowrap rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
            Select the words first
          </span>
        )}
        {full && (
          <ToolButton
            title={moreTools ? "Fewer options" : "More formatting"}
            active={moreTools}
            onClick={() => setMoreTools((v) => !v)}
          >
            <MoreHorizontal size={14} />
          </ToolButton>
        )}

        {moreTools && (
          <>
            <Divider />
            <select
              title="Font"
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                exec("fontName", e.target.value);
                e.target.selectedIndex = 0;
              }}
              className="h-7 rounded border border-slate-200 bg-white px-1 text-xs text-slate-600 outline-none hover:bg-slate-50"
            >
              <option value="">Font</option>
              {FONTS.map((f) => (
                <option key={f.label} value={f.css}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              title="Text size"
              onMouseDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                exec("fontSize", SIZE_TO_LEGACY[Number(e.target.value)]);
                e.target.selectedIndex = 0;
              }}
              className="h-7 rounded border border-slate-200 bg-white px-1 text-xs text-slate-600 outline-none hover:bg-slate-50"
            >
              <option value="">Size</option>
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <Divider />
            <ToolButton title="Strikethrough" onClick={() => exec("strikeThrough")}>
              <Strikethrough size={14} />
            </ToolButton>
            <ToolButton title="Superscript" onClick={() => exec("superscript")}>
              <Superscript size={14} />
            </ToolButton>
            <ToolButton title="Subscript" onClick={() => exec("subscript")}>
              <Subscript size={14} />
            </ToolButton>
            <ToolButton title="Remove formatting" onClick={() => exec("removeFormat")}>
              <Eraser size={14} />
            </ToolButton>
            <Divider />
            <ToolButton title="Checklist" onClick={insertChecklist}>
              <CheckSquare size={14} />
            </ToolButton>
            <ToolButton title="Decrease indent (⇧Tab)" onClick={() => exec("outdent")}>
              <Outdent size={14} />
            </ToolButton>
            <ToolButton title="Increase indent (Tab)" onClick={() => exec("indent")}>
              <Indent size={14} />
            </ToolButton>
            <Divider />
            <ToolButton title="Align left" onClick={() => exec("justifyLeft")}>
              <AlignLeft size={14} />
            </ToolButton>
            <ToolButton title="Align center" onClick={() => exec("justifyCenter")}>
              <AlignCenter size={14} />
            </ToolButton>
            <ToolButton title="Align right" onClick={() => exec("justifyRight")}>
              <AlignRight size={14} />
            </ToolButton>
            <ToolButton title="Insert link (⌘K)" onClick={insertLink}>
              <Link2 size={14} />
            </ToolButton>
            {onUploadImage && (
              <>
                <ToolButton
                  title={uploading ? "Uploading…" : "Insert image"}
                  onClick={() => fileRef.current?.click()}
                >
                  <ImageIcon size={14} className={uploading ? "animate-pulse" : ""} />
                </ToolButton>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) =>
                    e.target.files?.[0] && handleImageFile(e.target.files[0])
                  }
                />
              </>
            )}
          </>
        )}

        {cloze && (
          <>
            <Divider />
            <ToolButton title="New cloze (⌘⇧C)" onClick={() => insertCloze(false)}>
              <span className="flex items-center text-[10px] font-bold">
                <Brackets size={13} />+
              </span>
            </ToolButton>
            <ToolButton
              title="Same-number cloze — groups blanks onto one card (⌘⇧⌥C)"
              onClick={() => insertCloze(true)}
            >
              <span className="flex items-center text-[10px] font-bold">
                <Brackets size={13} />=
              </span>
            </ToolButton>
          </>
        )}
      </div>

      {/* Positioning context for the floating selection bar, and the box the
          writing area stretches inside when the editor fills its column. */}
      <div className={`relative ${fill ? "flex min-h-0 flex-1 flex-col" : ""}`}>
        {full && bubble && (
          <div
            className="absolute z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-slate-700 bg-slate-800 px-1 py-1 shadow-xl"
            style={{ top: bubble.top, left: bubble.left }}
          >
            {(
              [
                ["bold", Bold, "Bold"],
                ["italic", Italic, "Italic"],
                ["underline", Underline, "Underline"],
                ["strikeThrough", Strikethrough, "Strikethrough"],
              ] as const
            ).map(([cmd, Icon, title]) => (
              <button
                key={cmd}
                type="button"
                title={title}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => exec(cmd)}
                className="flex h-6 w-6 items-center justify-center rounded text-slate-200 hover:bg-slate-700 hover:text-white"
              >
                <Icon size={13} />
              </button>
            ))}
            <button
              type="button"
              title="Highlight"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => exec("hiliteColor", "#fef08a")}
              className="flex h-6 w-6 items-center justify-center rounded text-slate-200 hover:bg-slate-700 hover:text-white"
            >
              <Highlighter size={13} />
            </button>
            <button
              type="button"
              title="Insert link (⌘K)"
              onMouseDown={(e) => e.preventDefault()}
              onClick={insertLink}
              className="flex h-6 w-6 items-center justify-center rounded text-slate-200 hover:bg-slate-700 hover:text-white"
            >
              <Link2 size={13} />
            </button>
            {cloze && (
              <button
                type="button"
                title="Make cloze (⌘⇧C)"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertCloze(false)}
                className="flex h-6 items-center gap-0.5 rounded px-1 text-[10px] font-bold text-slate-200 hover:bg-slate-700 hover:text-white"
              >
                <Brackets size={12} />+
              </button>
            )}
          </div>
        )}

        <div
          ref={ref}
          contentEditable
          onInput={emit}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
            scheduleHistory();
          }}
          onPaste={handlePaste}
          onBlur={() => setColorOpen(null)}
          data-placeholder={placeholder}
          className={`prose-card ${
            fill ? "min-h-0 flex-1" : `${minHeightClass} ${maxHeightClass}`
          } ${contentClass} overflow-y-auto outline-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]`}
        />
      </div>

      {wordCount && (
        <div className="flex justify-end border-t border-slate-100 px-3 py-1 text-[11px] text-slate-400">
          {counts.words} word{counts.words === 1 ? "" : "s"} · {counts.chars}{" "}
          character{counts.chars === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}
