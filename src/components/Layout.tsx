import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LogOut, NotebookPen, Repeat, Zap } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useStudyMode } from "../contexts/StudyModeContext";

export function Layout({ children }: { children: ReactNode }) {
  const { user, logOut } = useAuth();
  const { studyMode, setStudyMode } = useStudyMode();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const inNotes = pathname.startsWith("/notes");
  const theme = inNotes ? "theme-notes" : studyMode === "anki" ? "theme-anki" : "theme-quizlet";

  return (
    <div
      className={`min-h-screen ${theme}`}
      style={{ background: "var(--page-bg)" }}
    >
      <div className="h-1.5 w-full" style={{ backgroundColor: "var(--accent)" }} />
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center" style={{ gap: "11px" }}>
            <img src="/logo.png" alt="Recallis" className="h-9 w-9 object-contain" />
            <span
              style={{
                fontFamily: "'Inter', system-ui, sans-serif",
                fontWeight: 600,
                fontSize: "26px",
                letterSpacing: "-0.02em",
                color: "#002871",
                lineHeight: 1,
              }}
            >
              Recallis
            </span>
            {inNotes && (
              <span
                className="hidden text-[26px] text-slate-400 sm:inline"
                style={{
                  fontFamily: "'Inter', system-ui, sans-serif",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                }}
              >
                Notes
              </span>
            )}
            <span
              className="ml-1 hidden rounded-full px-2 py-1 uppercase text-white sm:inline"
              style={{
                backgroundColor: "var(--accent)",
                fontFamily: "'Inter', system-ui, sans-serif",
                fontWeight: 500,
                fontSize: "11px",
                letterSpacing: "0.05em",
                lineHeight: 1,
              }}
            >
              {inNotes
                ? "Lectures"
                : studyMode === "anki"
                  ? "Anki · spaced"
                  : "Quizlet · cram"}
            </span>
          </Link>
          {user && (
            <div className="flex items-center gap-3 text-sm">
              <Link
                to="/notes"
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  inNotes
                    ? "border-transparent bg-blue-700 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
                title="Lecture notes — take notes, drop in slides, turn them into cards"
              >
                <NotebookPen size={12} /> Notes
              </Link>
              <div
                className="flex overflow-hidden rounded-full border border-slate-200 text-xs font-semibold"
                title="Anki mode: spaced repetition — cards come back over days. Quizlet mode: cram freely without touching the schedule."
              >
                <button
                  onClick={() => setStudyMode("anki")}
                  className={`flex items-center gap-1 px-3 py-1.5 transition ${
                    studyMode === "anki"
                      ? "bg-emerald-600 text-white"
                      : "bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  <Repeat size={12} /> Anki
                </button>
                <button
                  onClick={() => setStudyMode("quizlet")}
                  className={`flex items-center gap-1 px-3 py-1.5 transition ${
                    studyMode === "quizlet"
                      ? "bg-red-600 text-white"
                      : "bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  <Zap size={12} /> Quizlet
                </button>
              </div>
              <span className="hidden text-slate-500 sm:inline">
                {user.displayName || user.email}
              </span>
              <button
                onClick={async () => {
                  await logOut();
                  navigate("/login");
                }}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <LogOut size={14} />
                Log out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
