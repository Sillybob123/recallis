import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  CalendarCheck,
  Layers,
  LogOut,
  NotebookPen,
  Repeat,
  Zap,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { useStudyMode } from "../contexts/StudyModeContext";

export function Layout({
  children,
  wide = false,
}: {
  children: ReactNode;
  /** Full-bleed: for pages that lay out their own columns to the edges. */
  wide?: boolean;
}) {
  const { user, logOut } = useAuth();
  const { studyMode } = useStudyMode();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Which section owns this page — drives the theme, wordmark and nav state.
  const inNotes = pathname.startsWith("/notes");
  const inPlanner = pathname.startsWith("/planner");
  const inDecks =
    pathname.startsWith("/decks") ||
    pathname.startsWith("/deck/") ||
    pathname.startsWith("/study-group");
  const inAnki = pathname.startsWith("/anki") || pathname.startsWith("/browse");
  const inQuizlet = pathname.startsWith("/quizlet");
  // The overview page is deliberately neutral: nothing highlighted.
  const isHome = pathname === "/";

  const theme = inNotes
    ? "theme-notes"
    : isHome
      ? "theme-home"
      : inAnki
        ? "theme-anki"
        : studyMode === "anki"
          ? "theme-anki"
          : "theme-quizlet";

  const suffix = inNotes
    ? "Notes"
    : isHome
      ? ""
      : inAnki || (inDecks && studyMode === "anki")
        ? "Anki"
        : "Quizlet";
  // The Anki nav stays lit on /browse too — Browse is part of that section.

  const badge = inNotes
    ? "Lectures"
    : isHome
      ? "Overview"
      : suffix === "Anki"
        ? "Anki · spaced"
        : "Quizlet · cram";

  return (
    <div className={`min-h-screen ${theme}`} style={{ background: "var(--page-bg)" }}>
      <div className="h-1.5 w-full" style={{ backgroundColor: "var(--accent)" }} />
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="flex min-w-0 shrink items-center"
            style={{ gap: "11px" }}
            title="Home"
          >
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
            {suffix && (
              <span
                className="hidden text-[26px] text-slate-400 sm:inline"
                style={{
                  fontFamily: "'Inter', system-ui, sans-serif",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                }}
              >
                {suffix}
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
              {badge}
            </span>
          </Link>

          {user && (
            <div className="scrollbar-none flex min-w-0 items-center gap-2 overflow-x-auto text-sm">
              <NavPill to="/decks" active={inDecks} activeClass="bg-slate-800">
                <Layers size={12} /> <span className="hidden sm:inline">Decks</span>
              </NavPill>
              <NavPill to="/notes" active={inNotes} activeClass="bg-blue-700">
                <NotebookPen size={12} /> <span className="hidden sm:inline">Notes</span>
              </NavPill>
              <NavPill to="/planner" active={inPlanner} activeClass="bg-violet-700">
                <CalendarCheck size={12} />{" "}
                <span className="hidden sm:inline">Planner</span>
              </NavPill>

              <div className="flex overflow-hidden rounded-full border border-slate-200 text-xs font-semibold">
                <Link
                  to="/anki"
                  className={`flex items-center gap-1 px-3 py-1.5 transition ${
                    inAnki
                      ? "bg-emerald-600 text-white"
                      : "bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                  title="Spaced repetition — cards come back over days"
                >
                  <Repeat size={12} /> <span className="hidden sm:inline">Anki</span>
                </Link>
                <Link
                  to="/quizlet"
                  className={`flex items-center gap-1 px-3 py-1.5 transition ${
                    inQuizlet
                      ? "bg-red-600 text-white"
                      : "bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                  title="Cram freely without touching your schedule"
                >
                  <Zap size={12} /> <span className="hidden sm:inline">Quizlet</span>
                </Link>
              </div>

              <span className="ml-1 hidden text-slate-500 lg:inline">
                {user.displayName || user.email}
              </span>
              <button
                onClick={async () => {
                  await logOut();
                  navigate("/login");
                }}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <LogOut size={14} />
                <span className="hidden sm:inline">Log out</span>
              </button>
            </div>
          )}
        </div>
      </header>
      <main
        className={
          wide ? "px-3 pb-3 pt-3" : "mx-auto max-w-6xl px-4 py-8 sm:px-6"
        }
      >
        {children}
      </main>
    </div>
  );
}

function NavPill({
  to,
  active,
  activeClass,
  children,
}: {
  to: string;
  active: boolean;
  activeClass: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? `border-transparent text-white ${activeClass}`
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {children}
    </Link>
  );
}
