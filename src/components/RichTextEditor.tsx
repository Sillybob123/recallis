import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Brackets,
  Eraser,
  Highlighter,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  Subscript,
  Superscript,
  Underline,
} from "lucide-react";

const TEXT_COLORS = ["#dc2626", "#2563eb", "#059669", "#d97706", "#7c3aed", "#0f172a"];
const HILITE_COLORS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#fed7aa"];

/**
 * Anki-style rich text field: contenteditable with a formatting toolbar.
 * Shortcuts: ⌘/Ctrl+B/I/U (native), ⌘/Ctrl+Shift+C new cloze,
 * ⌘/Ctrl+Shift+Alt+C same-number cloze.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  cloze = false,
  minHeightClass = "min-h-20",
  onUploadImage,
  autoFocus,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  cloze?: boolean;
  minHeightClass?: string;
  onUploadImage?: (file: File) => Promise<string>;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [colorOpen, setColorOpen] = useState<null | "fore" | "hilite">(null);

  // Set initial content once; afterwards the div owns its own DOM.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
    if (autoFocus) ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function emit() {
    if (ref.current) onChange(ref.current.innerHTML);
  }

  function exec(cmd: string, val?: string) {
    ref.current?.focus();
    document.execCommand(cmd, false, val);
    emit();
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

  function handleKeyDown(e: React.KeyboardEvent) {
    if (cloze && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      insertCloze(e.altKey);
    }
  }

  function ToolButton({
    title,
    onClick,
    children,
  }: {
    title: string;
    onClick: () => void;
    children: React.ReactNode;
  }) {
    return (
      <button
        type="button"
        title={title}
        onMouseDown={(e) => e.preventDefault()} // keep selection in the editor
        onClick={onClick}
        className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      >
        {children}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-300 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100">
      <div className="relative flex flex-wrap items-center gap-0.5 border-b border-slate-200 px-1.5 py-1">
        <ToolButton title="Bold (⌘B)" onClick={() => exec("bold")}>
          <Bold size={14} />
        </ToolButton>
        <ToolButton title="Italic (⌘I)" onClick={() => exec("italic")}>
          <Italic size={14} />
        </ToolButton>
        <ToolButton title="Underline (⌘U)" onClick={() => exec("underline")}>
          <Underline size={14} />
        </ToolButton>
        <ToolButton title="Superscript" onClick={() => exec("superscript")}>
          <Superscript size={14} />
        </ToolButton>
        <ToolButton title="Subscript" onClick={() => exec("subscript")}>
          <Subscript size={14} />
        </ToolButton>

        <ToolButton
          title="Text color"
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
          <div className="absolute left-24 top-8 z-20 flex gap-1 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
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

        <ToolButton title="Remove formatting" onClick={() => exec("removeFormat")}>
          <Eraser size={14} />
        </ToolButton>
        <ToolButton title="Bulleted list" onClick={() => exec("insertUnorderedList")}>
          <List size={14} />
        </ToolButton>
        <ToolButton title="Numbered list" onClick={() => exec("insertOrderedList")}>
          <ListOrdered size={14} />
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
              onChange={(e) => e.target.files?.[0] && handleImageFile(e.target.files[0])}
            />
          </>
        )}

        {cloze && (
          <>
            <span className="mx-1 h-4 w-px bg-slate-200" />
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
      <div
        ref={ref}
        contentEditable
        onInput={emit}
        onKeyDown={handleKeyDown}
        data-placeholder={placeholder}
        className={`prose-card ${minHeightClass} max-h-64 overflow-y-auto px-3 py-2 text-sm outline-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]`}
      />
    </div>
  );
}
