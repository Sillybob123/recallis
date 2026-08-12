import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  CalendarCheck,
  Layers,
  LogOut,
  MessageSquare,
  UserRound,
  NotebookPen,
  Repeat,
  Zap,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { FeedbackModal } from "./FeedbackModal";
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
  const [feedbackOpen, setFeedbackOpen] = useState(false);
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

              <ProfileMenu
                name={user.displayName}
                email={user.email}
                onFeedback={() => setFeedbackOpen(true)}
                onSettings={() => navigate("/account")}
                onLogOut={async () => {
                  await logOut();
                  navigate("/login");
                }}
              />
            </div>
          )}
        </div>
      </header>
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}

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

/** "Yair Ben-Dor" → "YB"; an address falls back to its first letter. */
function initialsOf(name: string | null, email: string | null): string {
  const source = (name ?? "").trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : ""))
      .toUpperCase();
  }
  return (email ?? "?").trim().charAt(0).toUpperCase() || "?";
}

/**
 * Everything about you, behind one circle: the three separate controls this
 * replaces were three things in the header competing with the navigation,
 * and none of them is pressed often.
 */
function ProfileMenu({
  name,
  email,
  onFeedback,
  onSettings,
  onLogOut,
}: {
  name: string | null;
  email: string | null;
  onFeedback: () => void;
  onSettings: () => void;
  onLogOut: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={name || email || "Account"}
        className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white transition hover:opacity-90"
        style={{ backgroundColor: "var(--accent)" }}
      >
        {initialsOf(name, email)}
      </button>

      {open && (
        <>
          <button
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
          >
            <div className="border-b border-slate-100 px-3 py-2.5">
              <p className="truncate text-sm font-semibold text-slate-800">
                {name || "Your account"}
              </p>
              {email && (
                <p className="truncate text-xs text-slate-400">{email}</p>
              )}
            </div>
            <MenuItem
              icon={<UserRound size={14} />}
              onClick={() => {
                setOpen(false);
                onSettings();
              }}
            >
              Account &amp; stats
            </MenuItem>
            <MenuItem
              icon={<MessageSquare size={14} />}
              onClick={() => {
                setOpen(false);
                onFeedback();
              }}
            >
              Send feedback
            </MenuItem>
            <div className="border-t border-slate-100">
              <MenuItem
                icon={<LogOut size={14} />}
                danger
                onClick={() => {
                  setOpen(false);
                  onLogOut();
                }}
              >
                Log out
              </MenuItem>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  danger = false,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition ${
        danger
          ? "text-red-600 hover:bg-red-50"
          : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      <span className={danger ? "text-red-400" : "text-slate-400"}>{icon}</span>
      {children}
    </button>
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
