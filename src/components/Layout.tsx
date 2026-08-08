import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOut, Repeat, Zap } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useStudyMode } from "../contexts/StudyModeContext";

export function Layout({ children }: { children: ReactNode }) {
  const { user, logOut } = useAuth();
  const { studyMode, setStudyMode } = useStudyMode();
  const navigate = useNavigate();

  return (
    <div
      className={`min-h-screen ${studyMode === "anki" ? "theme-anki" : "theme-quizlet"}`}
      style={{ background: "var(--page-bg)" }}
    >
      <div className="h-1.5 w-full" style={{ backgroundColor: "var(--accent)" }} />
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-bold text-slate-900">
            <img src="/logo.png" alt="Recallis" className="h-9 w-9 object-contain" />
            <span className="text-lg">Recallis</span>
            <span
              className="ml-1 hidden rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white sm:inline"
              style={{ backgroundColor: "var(--accent)" }}
            >
              {studyMode === "anki" ? "Anki · spaced" : "Quizlet · cram"}
            </span>
          </Link>
          {user && (
            <div className="flex items-center gap-3 text-sm">
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
