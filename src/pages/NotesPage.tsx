import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  Clock,
  FileText,
  FolderPlus,
  Images,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Layout } from "../components/Layout";
import { createNote, deleteNote, updateNote, watchNotes } from "../lib/firestore";
import type { Note } from "../types";
import { stripHtmlInline } from "../lib/text";
import { usePageTitle } from "../lib/pageTitle";

const UNFILED = "__unfiled__";

function plainText(html: string): string {
  return stripHtmlInline(html);
}

function relativeDay(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function NotesPage() {
  usePageTitle("Lecture notes");
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [showNew, setShowNew] = useState<null | { className: string }>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!user) return;
    return watchNotes(user.uid, setNotes);
  }, [user]);

  const classes = useMemo(() => {
    const map = new Map<string, Note[]>();
    for (const n of notes ?? []) {
      const key = n.className.trim() || UNFILED;
      const list = map.get(key) ?? [];
      list.push(n);
      map.set(key, list);
    }
    return map;
  }, [notes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return (notes ?? []).filter((n) => {
      const haystack = [
        n.title,
        n.className,
        plainText(n.content),
        ...n.slides.map((s) => plainText(s.note)),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [notes, search]);

  const stats = useMemo(() => {
    const all = notes ?? [];
    const weekAgo = Date.now() - 7 * 86400000;
    return {
      notes: all.length,
      classes: new Set(all.map((n) => n.className.trim()).filter(Boolean)).size,
      slides: all.reduce((sum, n) => sum + n.slides.length, 0),
      thisWeek: all.filter((n) => n.updatedAt >= weekAgo).length,
    };
  }, [notes]);

  const recent = useMemo(
    () => [...(notes ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4),
    [notes]
  );

  async function handleDelete(note: Note) {
    if (
      confirm(
        `Delete the note "${note.title}"${note.slides.length ? ` and its ${note.slides.length} slides` : ""}?\n\nCards you already made from it are not affected.`
      )
    ) {
      await deleteNote(user!.uid, note.id, note.slides);
    }
  }

  async function handleRename(note: Note) {
    const title = prompt("Rename note:", note.title);
    if (title && title.trim() && title.trim() !== note.title) {
      await updateNote(user!.uid, note.id, { title: title.trim() });
    }
  }

  return (
    <Layout>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lecture notes</h1>
          <p className="text-sm text-slate-500">
            Take notes in class, drop in your slides, and turn anything into
            flashcards without leaving the page.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowNew({ className: "" })}
            className="flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800"
          >
            <Plus size={16} /> New note
          </button>
        </div>
      </div>

      {notes === null ? (
        <div className="py-24 text-center text-slate-400">Loading notes…</div>
      ) : notes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center">
          <FileText className="mx-auto mb-3 text-slate-300" size={40} />
          <p className="mb-1 font-medium text-slate-700">No notes yet</p>
          <p className="mb-4 text-sm text-slate-500">
            Make one per lecture — you can drop the lecture's PDF or PowerPoint
            slides straight into it.
          </p>
          <button
            onClick={() => setShowNew({ className: "" })}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Create your first note
          </button>
        </div>
      ) : (
        <>
          {/* activity summary */}
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Notes" value={stats.notes} icon={<FileText size={14} />} />
            <StatCard label="Classes" value={stats.classes} icon={<FolderPlus size={14} />} />
            <StatCard label="Slides" value={stats.slides} icon={<Images size={14} />} />
            <StatCard
              label="Edited this week"
              value={stats.thisWeek}
              icon={<Clock size={14} />}
            />
          </div>

          {/* jump back in */}
          {recent.length > 0 && !search && (
            <section className="mb-6">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                Jump back in
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {recent.map((n) => (
                  <Link
                    key={n.id}
                    to={`/notes/${n.id}`}
                    className="group rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
                  >
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {n.title}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {n.className || "Unfiled"} · {relativeDay(n.updatedAt)}
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-snug text-slate-500">
                      {plainText(n.content).slice(0, 120) || "Empty note"}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* search */}
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <Search size={15} className="shrink-0 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search every note, including slide notes…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={15} />
              </button>
            )}
          </div>

          {filtered ? (
            <section className="rounded-2xl border border-slate-200 bg-white">
              <p className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-500">
                {filtered.length} result{filtered.length === 1 ? "" : "s"} for “{search}”
              </p>
              {filtered.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-400">
                  Nothing matched. Try a different word.
                </p>
              ) : (
                <ul className="px-2 py-1.5">
                  {filtered.map((n) => (
                    <NoteRow
                      key={n.id}
                      note={n}
                      showClass
                      onDelete={handleDelete}
                      onRename={handleRename}
                    />
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <div className="space-y-4">
              {Array.from(classes.entries())
                .sort(([a], [b]) =>
                  a === UNFILED ? 1 : b === UNFILED ? -1 : a.localeCompare(b)
                )
                .map(([className, list]) => (
                  <ClassSection
                    key={className}
                    className={className === UNFILED ? "" : className}
                    list={list}
                    onAddNote={() =>
                      setShowNew({
                        className: className === UNFILED ? "" : className,
                      })
                    }
                    onDelete={handleDelete}
                    onRename={handleRename}
                  />
                ))}
              <button
                onClick={() => setShowNew({ className: "" })}
                className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 transition hover:border-blue-400 hover:text-blue-700"
              >
                <FolderPlus size={15} /> Start a new class or lecture
              </button>
            </div>
          )}
        </>
      )}

      {showNew && (
        <NewNoteModal
          initialClass={showNew.className}
          existingClasses={Array.from(classes.keys()).filter((c) => c !== UNFILED)}
          onClose={() => setShowNew(null)}
          onCreate={async (title, className) => {
            const id = await createNote(user!.uid, title, className);
            navigate(`/notes/${id}`);
          }}
        />
      )}
    </Layout>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 text-xl font-bold text-slate-800">{value}</p>
    </div>
  );
}

function ClassSection({
  className,
  list,
  onAddNote,
  onDelete,
  onRename,
}: {
  className: string;
  list: Note[];
  onAddNote: () => void;
  onDelete: (n: Note) => void;
  onRename: (n: Note) => void;
}) {
  const key = `noteClass:${className || UNFILED}`;
  const [open, setOpen] = useState(() => localStorage.getItem(key) !== "closed");
  const slideCount = list.reduce((s, n) => s + n.slides.length, 0);

  function toggle() {
    setOpen((o) => {
      localStorage.setItem(key, o ? "closed" : "open");
      return !o;
    });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            size={17}
            className={`shrink-0 text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`}
          />
          <span className="truncate font-bold text-slate-900">
            {className || "Unfiled"}
          </span>
          <span className="shrink-0 text-xs text-slate-400">
            {list.length} lecture{list.length === 1 ? "" : "s"}
            {slideCount > 0 && ` · ${slideCount} slides`}
          </span>
        </button>
        <button
          onClick={onAddNote}
          className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-blue-400 hover:text-blue-700"
          title={`Add a lecture to ${className || "this group"}`}
        >
          <Plus size={13} /> Lecture
        </button>
      </div>
      {open && (
        <ul className="border-t border-slate-100 px-2 py-1.5">
          {list
            .slice()
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                onDelete={onDelete}
                onRename={onRename}
              />
            ))}
        </ul>
      )}
    </section>
  );
}

function NoteRow({
  note,
  showClass,
  onDelete,
  onRename,
}: {
  note: Note;
  showClass?: boolean;
  onDelete: (n: Note) => void;
  onRename: (n: Note) => void;
}) {
  const preview = plainText(note.content);
  return (
    <li className="group flex items-center">
      <Link
        to={`/notes/${note.id}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-slate-50"
      >
        <FileText size={16} className="shrink-0 text-slate-400" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-800">
              {note.title}
            </span>
            {showClass && note.className && (
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                {note.className}
              </span>
            )}
            {note.slides.length > 0 && (
              <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-slate-400">
                <Images size={11} /> {note.slides.length}
              </span>
            )}
          </span>
          {preview && (
            <span className="mt-0.5 block truncate text-xs text-slate-400">
              {preview.slice(0, 110)}
            </span>
          )}
        </span>
        <span className="ml-auto shrink-0 text-xs text-slate-400">
          {relativeDay(note.updatedAt)}
        </span>
      </Link>
      <button
        onClick={() => onRename(note)}
        className="p-1.5 text-slate-300 opacity-0 transition hover:text-slate-600 group-hover:opacity-100"
        title="Rename"
      >
        <Pencil size={14} />
      </button>
      <button
        onClick={() => onDelete(note)}
        className="p-1.5 text-slate-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
        title="Delete"
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}

function NewNoteModal({
  initialClass,
  existingClasses,
  onCreate,
  onClose,
}: {
  initialClass: string;
  existingClasses: string[];
  onCreate: (title: string, className: string) => Promise<void>;
  onClose: () => void;
}) {
  const today = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const [title, setTitle] = useState("");
  const [className, setClassName] = useState(initialClass);
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">New lecture note</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return;
            setBusy(true);
            try {
              await onCreate(title.trim(), className.trim());
            } finally {
              setBusy(false);
            }
          }}
          className="space-y-4"
        >
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-slate-700">
              Lecture title
            </span>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`e.g. Brachial Plexus — ${today}`}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-slate-700">
              Class{" "}
              <span className="font-normal text-slate-400">
                — pick one or type a new one
              </span>
            </span>
            <input
              value={className}
              onChange={(e) => setClassName(e.target.value)}
              placeholder="e.g. Anatomy"
              list="note-classes"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10"
            />
            <datalist id="note-classes">
              {existingClasses.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>

          {existingClasses.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {existingClasses.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setClassName(c)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    className === c
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="w-full rounded-lg bg-blue-700 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create note"}
          </button>
        </form>
      </div>
    </div>
  );
}
