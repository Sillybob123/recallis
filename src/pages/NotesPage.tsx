import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, FileText, Plus, Trash2, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Layout } from "../components/Layout";
import { createNote, deleteNote, watchNotes } from "../lib/firestore";
import type { Note } from "../types";

export function NotesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    if (!user) return;
    return watchNotes(user.uid, setNotes);
  }, [user]);

  // Group by class name (Class → Lectures), untagged notes first.
  const groups = new Map<string, Note[]>();
  for (const n of notes ?? []) {
    const key = n.className.trim();
    const list = groups.get(key) ?? [];
    list.push(n);
    groups.set(key, list);
  }

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lecture notes</h1>
          <p className="text-sm text-slate-500">
            Take notes in class, drop in your lecture slides, and turn anything
            into flashcards without leaving the page.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
        >
          <Plus size={16} /> New note
        </button>
      </div>

      {notes === null ? (
        <div className="py-24 text-center text-slate-400">Loading notes…</div>
      ) : notes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center">
          <FileText className="mx-auto mb-3 text-slate-300" size={40} />
          <p className="mb-1 font-medium text-slate-700">No notes yet</p>
          <p className="mb-4 text-sm text-slate-500">
            Create one per lecture — you can upload the lecture's PDF slides
            right into it.
          </p>
          <button
            onClick={() => setShowNew(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Create a note
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {Array.from(groups.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([className, list]) => (
              <ClassNotes
                key={className || "__untagged"}
                className={className}
                list={list}
                onDelete={async (note) => {
                  if (
                    confirm(
                      `Delete the note "${note.title}"${note.slides.length ? ` and its ${note.slides.length} slides` : ""}? Cards made from it are not affected.`
                    )
                  ) {
                    await deleteNote(user!.uid, note.id, note.slides);
                  }
                }}
              />
            ))}
        </div>
      )}

      {showNew && (
        <NewNoteModal
          onClose={() => setShowNew(false)}
          existingClasses={Array.from(groups.keys()).filter(Boolean)}
          onCreate={async (title, className) => {
            const id = await createNote(user!.uid, title, className);
            navigate(`/notes/${id}`);
          }}
        />
      )}
    </Layout>
  );
}

function ClassNotes({
  className,
  list,
  onDelete,
}: {
  className: string;
  list: Note[];
  onDelete: (n: Note) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-5 py-3.5 text-left"
      >
        <ChevronDown
          size={18}
          className={`text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span className="font-bold text-slate-900">
          {className || "No class"}
        </span>
        <span className="ml-auto text-xs text-slate-400">
          {list.length} note{list.length === 1 ? "" : "s"}
        </span>
      </button>
      {open && (
        <ul className="border-t border-slate-100 px-3 py-2">
          {list.map((note) => (
            <li key={note.id} className="group flex items-center">
              <Link
                to={`/notes/${note.id}`}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50"
              >
                <FileText size={16} className="shrink-0 text-slate-400" />
                <span className="truncate text-sm font-medium text-slate-800">
                  {note.title}
                </span>
                {note.slides.length > 0 && (
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                    {note.slides.length} slides
                  </span>
                )}
                <span className="ml-auto shrink-0 text-xs text-slate-400">
                  {new Date(note.updatedAt).toLocaleDateString()}
                </span>
              </Link>
              <button
                onClick={() => onDelete(note)}
                className="p-2 text-slate-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NewNoteModal({
  existingClasses,
  onCreate,
  onClose,
}: {
  existingClasses: string[];
  onCreate: (title: string, className: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [className, setClassName] = useState(existingClasses[0] ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">New note</h2>
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
          className="space-y-3"
        >
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='Lecture title, e.g. "Lecture 4 — Brachial Plexus"'
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          <input
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            placeholder='Class, e.g. "Anatomy"'
            list="note-classes"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          <datalist id="note-classes">
            {existingClasses.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create note"}
          </button>
        </form>
      </div>
    </div>
  );
}
