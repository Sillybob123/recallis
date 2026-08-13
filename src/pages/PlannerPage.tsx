import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  CalendarX,
  Check,
  ChevronDown,
  Loader2,
  Mail,
  MoreHorizontal,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Layout } from "../components/Layout";
import { EmailReminderSettings } from "../components/EmailReminderSettings";
import {
  fetchPlannerPlan,
  fetchPlannerProgress,
  savePlannerPlan,
  setPlannerProgress,
  setPlannerProgressBulk,
} from "../lib/firestore";
import { parseIcs } from "../lib/ics";
import { decodeEntities } from "../lib/ics";
import {
  agendaFor,
  DEFAULT_TASKS,
  dropSessionsBefore,
  examOutlook,
  isDone,
  makeTaskId,
  progressKey,
  repairSessions,
  SESSION_LABELS,
  sessionCompletion,
  sessionsFromEvents,
  startOfWeek,
  TASK_PRESETS,
  upcomingExams,
  type PlannerPlan,
  type PlannerProgress,
  type PlannerSession,
  type PlannerTask,
  type SessionKind,
} from "../lib/planner";
import { usePageTitle } from "../lib/pageTitle";
import {
  loadReminderSettings,
  markReminded,
  reminderDue,
  requestReminderPermission,
  saveReminderSettings,
  showReminder,
  type ReminderSettings,
} from "../lib/reminders";

const KIND_STYLES: Record<string, string> = {
  assessment: "bg-red-50 text-red-700 border-red-200",
  lab: "bg-emerald-50 text-emerald-700 border-emerald-200",
  smallGroup: "bg-violet-50 text-violet-700 border-violet-200",
  patient: "bg-sky-50 text-sky-700 border-sky-200",
  selfStudy: "bg-amber-50 text-amber-700 border-amber-200",
  lecture: "bg-slate-50 text-slate-600 border-slate-200",
  other: "bg-slate-50 text-slate-600 border-slate-200",
};

function dayLabel(at: number): string {
  return new Date(at).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
function timeLabel(s: PlannerSession): string {
  if (s.allDay) return "all day";
  // For a window, the time that matters is the one you have to beat.
  if (s.window && s.end) return `due ${timeOf(s.end)}`;
  return timeOf(s.start);
}
/** Day and time, spelling out a submission window as the span it is. */
function whenLabel(s: PlannerSession): string {
  if (s.allDay) return `${dayLabel(s.start)} · all day`;
  if (s.window && s.end) {
    const sameDay = dayLabel(s.start) === dayLabel(s.end);
    return sameDay
      ? `${dayLabel(s.start)} · ${timeOf(s.start)} – ${timeOf(s.end)}`
      : `${dayLabel(s.start)} ${timeOf(s.start)} → due ${dayLabel(s.end)} ${timeOf(s.end)}`;
  }
  return `${dayLabel(s.start)} · ${timeOf(s.start)}`;
}

export function PlannerPage() {
  usePageTitle("Planner");
  const { user } = useAuth();
  const [plan, setPlan] = useState<PlannerPlan | null>(null);
  const [progress, setProgress] = useState<PlannerProgress>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reminders, setReminders] = useState<ReminderSettings>(
    loadReminderSettings
  );
  const [weekFilter, setWeekFilter] = useState<number | "all">("all");
  const [editingRoutine, setEditingRoutine] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAllExams, setShowAllExams] = useState(false);
  const [editingSession, setEditingSession] = useState<PlannerSession | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [p, pr] = await Promise.all([
        fetchPlannerPlan(user.uid).catch(() => null),
        fetchPlannerProgress(user.uid).catch(() => ({})),
      ]);
      if (cancelled) return;
      // Plans imported before entities were decoded have "&amp;" baked into
      // their topics; fix them on the way in so nobody has to re-import.
      setPlan(
        p
          ? {
              ...p,
              name: decodeEntities(p.name ?? ""),
              sessions: repairSessions(p.sessions ?? [], decodeEntities),
            }
          : null
      );
      setProgress(pr);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const toggle = useCallback(
    (session: PlannerSession, task: PlannerTask) => {
      if (!user) return;
      const key = progressKey(session.id, task.id);
      const next = !progress[key];
      // Optimistic: a checkbox that waits for the network feels broken.
      setProgress((p) => ({ ...p, [key]: next }));
      setPlannerProgress(user.uid, key, next).catch(() =>
        setNotice("That tick didn't save — check your connection.")
      );
    },
    [user, progress]
  );

  const toggleWholeSession = useCallback(
    (session: PlannerSession) => {
      if (!user || !plan) return;
      const complete = sessionCompletion(progress, session, plan.tasks) === 1;
      const entries: Record<string, boolean> = {};
      for (const t of plan.tasks) {
        entries[progressKey(session.id, t.id)] = !complete;
      }
      setProgress((p) => ({ ...p, ...entries }));
      setPlannerProgressBulk(user.uid, entries).catch(() =>
        setNotice("That didn't save — check your connection.")
      );
    },
    [user, plan, progress]
  );

  const saveRoutine = useCallback(
    async (tasks: PlannerTask[]) => {
      if (!user) return;
      // A plan can exist before a timetable does, so the routine is editable
      // from the empty state too.
      const next: PlannerPlan = plan
        ? { ...plan, tasks, updatedAt: Date.now() }
        : {
            name: "Academic planner",
            tasks,
            sessions: [],
            examLeadDays: 7,
            updatedAt: Date.now(),
          };
      setPlan(next);
      setEditingRoutine(false);
      try {
        await savePlannerPlan(user.uid, next);
      } catch {
        setNotice("Couldn't save the routine — check your connection.");
      }
    },
    [user, plan]
  );

  async function importIcs(file: File) {
    if (!user) return;
    setBusy("Reading calendar…");
    setNotice(null);
    try {
      const text = await file.text();
      const { events, warnings } = parseIcs(text);
      if (events.length === 0) {
        setNotice(
          "No sessions found in that file. Export your timetable as .ics from your calendar and try again."
        );
        return;
      }
      const sessions = sessionsFromEvents(events);
      const next: PlannerPlan = {
        name: plan?.name || file.name.replace(/\.ics$/i, ""),
        tasks: plan?.tasks?.length ? plan.tasks : DEFAULT_TASKS,
        sessions,
        examLeadDays: plan?.examLeadDays ?? 7,
        updatedAt: Date.now(),
      };
      await savePlannerPlan(user.uid, next);
      setPlan(next);
      const exams = sessions.filter((s) => s.kind === "assessment").length;
      setNotice(
        `Imported ${sessions.length} sessions across ${
          Math.max(...sessions.map((s) => s.week))
        } weeks, including ${exams} assessment${exams === 1 ? "" : "s"}.` +
          (warnings.length ? `\n\n${warnings.join("\n")}` : "")
      );
    } catch (err) {
      setNotice(`Couldn't read that file: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  // Fires while the app is open, which is the only thing a web page can do
  // without a push server — said plainly next to the toggle.
  useEffect(() => {
    if (!plan || !reminders.enabled) return;
    const tick = () => {
      const permission =
        typeof Notification === "undefined" ? "denied" : Notification.permission;
      if (!reminderDue(reminders, Date.now(), permission)) return;
      const { today, tomorrow } = agendaFor(plan.sessions);
      const left = today.filter(
        (s) => sessionCompletion(progress, s, plan.tasks) < 1
      ).length;
      showReminder(
        left > 0
          ? `${left} of today's ${today.length} sessions still need work` +
              (tomorrow.length
                ? `, and ${tomorrow.length} to preview for tomorrow.`
                : ".")
          : tomorrow.length
            ? `Today is done. ${tomorrow.length} sessions to preview for tomorrow.`
            : "Today is done."
      );
      const next = markReminded(reminders);
      setReminders(next);
      saveReminderSettings(next);
    };
    tick();
    const timer = setInterval(tick, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [plan, progress, reminders]);

  const outlook = useMemo(
    () => (plan ? examOutlook(plan, progress) : []),
    [plan, progress]
  );
  const soon = useMemo(
    () => upcomingExams(outlook, plan?.examLeadDays ?? 7),
    [outlook, plan]
  );
  const agenda = useMemo(
    () => agendaFor(plan?.sessions ?? []),
    [plan]
  );
  const weeks = useMemo(() => {
    const set = new Set((plan?.sessions ?? []).map((s) => s.week));
    return [...set].sort((a, b) => a - b);
  }, [plan]);

  /**
   * The week today falls in. Opening on it beats opening on the whole
   * semester: a year of lectures in one table is a wall, not a plan.
   */
  const currentWeek = useMemo(() => {
    if (!plan) return null;
    const today = startOfWeek(Date.now());
    const match = plan.sessions.find((s) => startOfWeek(s.start) === today);
    return match ? match.week : null;
  }, [plan]);

  useEffect(() => {
    if (currentWeek !== null) setWeekFilter(currentWeek);
  }, [currentWeek]);

  const shown = useMemo(() => {
    const list = [...(plan?.sessions ?? [])].sort((a, b) => a.start - b.start);
    return weekFilter === "all" ? list : list.filter((s) => s.week === weekFilter);
  }, [plan, weekFilter]);

  async function toggleReminders() {
    if (reminders.enabled) {
      const next = { ...reminders, enabled: false };
      setReminders(next);
      saveReminderSettings(next);
      return;
    }
    const granted = await requestReminderPermission();
    if (!granted) {
      setNotice(
        "Your browser blocked notifications. Allow them for this site in the address bar, then try again."
      );
      return;
    }
    const next = { ...reminders, enabled: true };
    setReminders(next);
    saveReminderSettings(next);
  }

  const savePlan = useCallback(
    async (next: PlannerPlan) => {
      if (!user) return;
      setPlan(next);
      setMenuOpen(false);
      try {
        await savePlannerPlan(user.uid, next);
      } catch {
        setNotice("That didn't save — check your connection.");
      }
    },
    [user]
  );

  /**
   * Correcting what the import guessed. Marked as edited so the repair pass
   * that runs on load never reverts a deliberate change.
   */
  const updateSession = useCallback(
    (id: string, patch: Partial<PlannerSession>) => {
      if (!plan) return;
      setEditingSession(null);
      void savePlan({
        ...plan,
        sessions: plan.sessions.map((s) =>
          s.id === id ? { ...s, ...patch, edited: true } : s
        ),
        updatedAt: Date.now(),
      });
    },
    [plan, savePlan]
  );

  const removeSession = useCallback(
    (id: string) => {
      if (!plan) return;
      setEditingSession(null);
      void savePlan({
        ...plan,
        sessions: plan.sessions.filter((s) => s.id !== id),
        updatedAt: Date.now(),
      });
    },
    [plan, savePlan]
  );

  const renamePlan = useCallback(
    (name: string) => {
      if (!plan) return;
      void savePlan({ ...plan, name: name.trim(), updatedAt: Date.now() });
    },
    [plan, savePlan]
  );

  /** Start fresh from today rather than scrolling past a term you've sat. */
  const clearPast = useCallback(() => {
    if (!plan) return;
    const kept = dropSessionsBefore(plan.sessions, Date.now());
    const removed = plan.sessions.length - kept.length;
    if (removed === 0) {
      setNotice("Nothing to clear — every session is today or later.");
      setMenuOpen(false);
      return;
    }
    if (
      !confirm(
        `Remove ${removed} session${removed === 1 ? "" : "s"} from before today?\n\n` +
          "Your ticks are kept, and re-importing the .ics brings them back."
      )
    ) {
      return;
    }
    setWeekFilter("all");
    void savePlan({ ...plan, sessions: kept, updatedAt: Date.now() });
  }, [plan, savePlan]);

  const clearTimetable = useCallback(() => {
    if (!plan) return;
    if (!confirm("Remove the imported timetable? Your ticks are kept.")) return;
    void savePlan({ ...plan, sessions: [], updatedAt: Date.now() });
  }, [plan, savePlan]);

  // An .ics exported by a portal is called something like
  // "icalexport1786291315"; that isn't a name, so it doesn't get shown as one.
  const planTitle =
    plan && plan.name && !/^i?cal[-_ ]?export[-_ ]?\d*$/i.test(plan.name.trim())
      ? plan.name
      : "Academic planner";

  const subtitle = useMemo(() => {
    if (!plan || plan.sessions.length === 0) {
      return "Your timetable, the routine you run on each session, and what's actually done.";
    }
    const exams = plan.sessions.filter((s) => s.kind === "assessment").length;
    const parts = [
      `${plan.sessions.length} sessions`,
      `${weeks.length} week${weeks.length === 1 ? "" : "s"}`,
    ];
    if (exams) parts.push(`${exams} assessment${exams === 1 ? "" : "s"}`);
    return parts.join(" · ");
  }, [plan, weeks]);

  if (loading) {
    return (
      <Layout>
        <div className="py-24 text-center text-slate-400">Loading your planner…</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <PlanTitle
            name={planTitle}
            onRename={plan ? renamePlan : undefined}
          />
          <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setEditingEmail(true)}
            title="Schedule what gets emailed to you, and when"
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <Mail size={14} /> Email
          </button>
          <button
            onClick={() => setEditingRoutine(true)}
            title="Choose the columns — the routine you run on every session"
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <SlidersHorizontal size={14} /> Routine
          </button>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CalendarPlus size={14} />
            )}
            {busy ?? (plan ? "Re-import" : "Import timetable (.ics)")}
            <input
              ref={fileRef}
              type="file"
              accept=".ics,text/calendar"
              className="hidden"
              disabled={Boolean(busy)}
              onChange={(e) => e.target.files?.[0] && importIcs(e.target.files[0])}
            />
          </label>
          {plan && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="More"
                className="flex h-[34px] w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-500 transition hover:bg-slate-50"
              >
                <MoreHorizontal size={16} />
              </button>
              {menuOpen && (
                <>
                  <button
                    aria-hidden
                    tabIndex={-1}
                    onClick={() => setMenuOpen(false)}
                    className="fixed inset-0 z-40 cursor-default"
                  />
                  <div className="absolute right-0 z-50 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                    <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5">
                      <span className="text-sm text-slate-700">
                        Browser reminder
                        <span className="block text-[11px] text-slate-400">
                          only while Recallis is open
                        </span>
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        <input
                          type="time"
                          value={`${String(Math.floor(reminders.atMinutes / 60)).padStart(2, "0")}:${String(reminders.atMinutes % 60).padStart(2, "0")}`}
                          onChange={(e) => {
                            const [h, m] = e.target.value.split(":").map(Number);
                            if (Number.isNaN(h) || Number.isNaN(m)) return;
                            const next = { ...reminders, atMinutes: h * 60 + m };
                            setReminders(next);
                            saveReminderSettings(next);
                          }}
                          className="w-[5.5rem] rounded border border-slate-200 px-1 py-0.5 text-xs tabular-nums outline-none"
                        />
                        <button
                          onClick={toggleReminders}
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${
                            reminders.enabled
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {reminders.enabled ? "On" : "Off"}
                        </button>
                      </div>
                    </div>
                    <div className="my-1 border-t border-slate-100" />
                    <button
                      onClick={clearPast}
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <CalendarX size={14} className="mt-0.5 shrink-0 text-slate-400" />
                      <span>
                        Clear everything before today
                        <span className="block text-[11px] text-slate-400">
                          start fresh; re-importing brings it back
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={clearTimetable}
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={14} className="mt-0.5 shrink-0" />
                      <span>
                        Remove the timetable
                        <span className="block text-[11px] text-red-400">
                          your ticks are kept
                        </span>
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
          <p className="whitespace-pre-line">{notice}</p>
          <button
            onClick={() => setNotice(null)}
            className="shrink-0 text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
      )}

      {editingEmail && user && (
        <EmailReminderSettings
          uid={user.uid}
          accountEmail={user.email ?? ""}
          plan={plan}
          progress={progress}
          onClose={() => setEditingEmail(false)}
        />
      )}

      {editingSession && (
        <SessionEditor
          session={editingSession}
          onCancel={() => setEditingSession(null)}
          onSave={updateSession}
          onDelete={removeSession}
        />
      )}

      {editingRoutine && (
        <RoutineEditor
          tasks={plan?.tasks?.length ? plan.tasks : DEFAULT_TASKS}
          onCancel={() => setEditingRoutine(false)}
          onSave={saveRoutine}
        />
      )}

      {!plan ? (
        <EmptyState onPick={() => fileRef.current?.click()} />
      ) : (
        <>
          {soon.length > 0 && (
            <section className="mb-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
                <AlertTriangle size={13} className="text-red-500" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Coming up
                </span>
              </div>
              <ul>
                {(showAllExams ? soon : soon.slice(0, 3)).map((e) => (
                  <li
                    key={e.session.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-50 px-4 py-2.5 last:border-b-0"
                  >
                    <span
                      className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-bold tabular-nums ${
                        e.daysAway <= 1
                          ? "bg-red-100 text-red-700"
                          : e.daysAway <= 3
                            ? "bg-amber-100 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {e.daysAway === 0
                        ? "today"
                        : e.daysAway === 1
                          ? "tomorrow"
                          : `${e.daysAway} days`}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
                      {e.session.topic}
                    </span>
                    <span className="text-xs text-slate-500">
                      {e.outstanding.length === 0
                        ? "everything it covers is done"
                        : `${e.outstanding.length} of ${e.covers.length} sessions unfinished`}
                    </span>
                    {e.outstanding.length > 0 && (
                      <button
                        onClick={() => setWeekFilter(e.outstanding[0].week)}
                        className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
                      >
                        Week {e.outstanding[0].week} →
                      </button>
                    )}
                    <button
                      onClick={() => updateSession(e.session.id, { kind: "other" })}
                      title="This isn't an assessment — stop counting sessions towards it"
                      className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      Not an exam
                    </button>
                    <button
                      onClick={() => setEditingSession(e.session)}
                      aria-label="Edit"
                      className="shrink-0 text-slate-300 hover:text-slate-600"
                    >
                      <Pencil size={13} />
                    </button>
                  </li>
                ))}
              </ul>
              {soon.length > 3 && (
                <button
                  onClick={() => setShowAllExams((v) => !v)}
                  className="flex w-full items-center justify-center gap-1 border-t border-slate-100 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
                >
                  <ChevronDown
                    size={13}
                    className={showAllExams ? "rotate-180 transition" : "transition"}
                  />
                  {showAllExams ? "Show fewer" : `${soon.length - 3} more`}
                </button>
              )}
            </section>
          )}

          <Today
            agenda={agenda}
            plan={plan}
            progress={progress}
            onToggle={toggle}
          />

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {currentWeek !== null && (
              <button
                onClick={() => setWeekFilter(currentWeek)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  weekFilter === currentWeek
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-indigo-600 ring-1 ring-indigo-200 hover:bg-indigo-50"
                }`}
              >
                This week
              </button>
            )}
            <button
              onClick={() => setWeekFilter("all")}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                weekFilter === "all"
                  ? "bg-slate-800 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              All weeks
            </button>
            {weeks.map((w) => (
              <button
                key={w}
                onClick={() => setWeekFilter(w)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  weekFilter === w
                    ? "bg-slate-800 text-white"
                    : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                }`}
              >
                {w}
              </button>
            ))}
          </div>

          <Grid
            sessions={shown}
            plan={plan}
            progress={progress}
            onToggle={toggle}
            onToggleRow={toggleWholeSession}
            onEdit={setEditingSession}
          />

        </>
      )}
    </Layout>
  );
}

/**
 * The columns are the whole point of the grid, so they're editable. Renaming
 * keeps a column's id, and therefore its ticks; only removing a column loses
 * anything, which is why that's the one thing spelled out.
 */
function RoutineEditor({
  tasks,
  onCancel,
  onSave,
}: {
  tasks: PlannerTask[];
  onCancel: () => void;
  onSave: (tasks: PlannerTask[]) => void;
}) {
  const [draft, setDraft] = useState<PlannerTask[]>(tasks);

  const update = (i: number, patch: Partial<PlannerTask>) =>
    setDraft((d) => d.map((t, j) => (i === j ? { ...t, ...patch } : t)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">Your routine</h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-sm leading-relaxed text-slate-500">
          One column per step you run on every session. Rename them freely —
          renaming keeps what you've already ticked. Removing a column deletes
          its ticks.
        </p>

        <div className="mb-4 flex flex-wrap gap-1.5">
          {TASK_PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => setDraft(p.tasks)}
              className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200"
            >
              {p.name}
            </button>
          ))}
        </div>

        <ul className="space-y-2">
          {draft.map((t, i) => (
            <li key={t.id} className="flex items-center gap-2">
              <input
                value={t.short}
                onChange={(e) => update(i, { short: e.target.value })}
                placeholder="Column"
                className="w-28 shrink-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm font-semibold outline-none focus:border-indigo-400"
              />
              <input
                value={t.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="What it means"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-400"
              />
              <button
                onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                title="Remove this column"
                className="shrink-0 text-slate-300 hover:text-red-500"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>

        {draft.length < 10 && (
          <button
            onClick={() =>
              setDraft((d) => [
                ...d,
                { id: makeTaskId("step", d), label: "", short: "New" },
              ])
            }
            className="mt-3 flex items-center gap-1 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
          >
            <Plus size={14} /> Add a column
          </button>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              onSave(
                draft
                  .map((t) => ({
                    ...t,
                    short: t.short.trim() || t.label.trim().slice(0, 12) || "Step",
                    label: t.label.trim() || t.short.trim(),
                  }))
                  .filter((t) => t.short)
              )
            }
            disabled={draft.length === 0}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Save routine
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The name of the plan, editable in place. Timetable exports are named for
 * the system that produced them, so the first thing anyone wants to do is
 * call it what the course is actually called.
 */
function PlanTitle({
  name,
  onRename,
}: {
  name: string;
  onRename?: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  if (!editing || !onRename) {
    return (
      <h1 className="group flex items-center gap-2 text-2xl font-bold text-slate-900">
        <span className="truncate">{name}</span>
        {onRename && (
          <button
            onClick={() => {
              setDraft(name);
              setEditing(true);
            }}
            aria-label="Rename"
            className="text-slate-300 opacity-0 transition group-hover:opacity-100 hover:text-slate-500"
          >
            <Pencil size={14} />
          </button>
        )}
      </h1>
    );
  }

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== name) onRename(draft);
  };
  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={commit}
        className="min-w-0 rounded-lg border border-slate-300 px-2 py-1 text-2xl font-bold text-slate-900 outline-none focus:border-indigo-400"
      />
      <button onClick={commit} className="text-emerald-600" aria-label="Save">
        <Check size={18} />
      </button>
    </div>
  );
}

/**
 * Fixing a row the import got wrong.
 *
 * A parser working from titles alone will misread some of them, and the
 * expensive mistake is a session wrongly called an assessment: the planner
 * then counts everything before it as revision for an exam that doesn't
 * exist. So the type is the first thing here, and it's one click.
 */
function SessionEditor({
  session,
  onCancel,
  onSave,
  onDelete,
}: {
  session: PlannerSession;
  onCancel: () => void;
  onSave: (id: string, patch: Partial<PlannerSession>) => void;
  onDelete: (id: string) => void;
}) {
  const [topic, setTopic] = useState(session.topic);
  const [kind, setKind] = useState<SessionKind>(session.kind);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Fix this session</h2>
            <p className="text-sm text-slate-500">
              {whenLabel(session)}
              {session.window && " — a window you work inside"}
            </p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-semibold text-slate-500">Title</span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          />
        </label>

        <span className="mb-1 block text-xs font-semibold text-slate-500">Type</span>
        <div className="mb-1 flex flex-wrap gap-1.5">
          {(Object.keys(SESSION_LABELS) as SessionKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                kind === k
                  ? k === "assessment"
                    ? "bg-red-600 text-white"
                    : "bg-indigo-600 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {SESSION_LABELS[k]}
            </button>
          ))}
        </div>
        <p className="mb-4 text-xs leading-relaxed text-slate-400">
          Only an <b>Assessment</b> gets a countdown and pulls the sessions
          before it in as revision.
        </p>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => {
              if (confirm(`Remove "${session.topic}" from the planner?`)) {
                onDelete(session.id);
              }
            }}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-red-500 hover:bg-red-50"
          >
            <Trash2 size={14} /> Remove
          </button>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={() => onSave(session.id, { topic: topic.trim() || session.topic, kind })}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <CalendarPlus size={28} className="mx-auto mb-3 text-slate-300" />
      <p className="mb-1 text-lg font-bold text-slate-800">
        Start with your timetable
      </p>
      <p className="mx-auto mb-5 max-w-lg text-sm leading-relaxed text-slate-500">
        Export your course calendar as an <b>.ics</b> file — every calendar app
        can do it, and most schools publish one directly. The planner reads the
        lectures, labs and small groups out of it, works out which week each
        falls in, and picks the assessments out so it can tell you what they
        cover.
      </p>
      <button
        onClick={onPick}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
      >
        Choose a .ics file
      </button>
      <p className="mx-auto mt-4 max-w-lg text-xs leading-relaxed text-slate-400">
        In Google Calendar: Settings → your calendar → Export. In Apple
        Calendar: File → Export. In Outlook: File → Save Calendar.
      </p>
    </div>
  );
}

function Today({
  agenda,
  plan,
  progress,
  onToggle,
}: {
  agenda: { today: PlannerSession[]; tomorrow: PlannerSession[] };
  plan: PlannerPlan;
  progress: PlannerProgress;
  onToggle: (s: PlannerSession, t: PlannerTask) => void;
}) {
  if (agenda.today.length === 0 && agenda.tomorrow.length === 0) return null;
  return (
    <section className="mb-4 grid gap-3 md:grid-cols-2">
      {(
        [
          ["Today", agenda.today],
          ["Tomorrow — worth previewing tonight", agenda.tomorrow],
        ] as const
      ).map(([title, list]) =>
        list.length === 0 ? null : (
          <div
            key={title}
            className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
          >
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              {title}
            </p>
            <ul className="space-y-2">
              {list.map((s) => (
                <li key={s.id}>
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    <span className="text-xs tabular-nums text-slate-400">
                      {timeLabel(s)}
                    </span>
                    {s.topic}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {plan.tasks.map((t) => {
                      const done = isDone(progress, s.id, t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => onToggle(s, t)}
                          title={t.label}
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition ${
                            done
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                          }`}
                        >
                          {t.short}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </section>
  );
}

function Grid({
  sessions,
  plan,
  progress,
  onToggle,
  onToggleRow,
  onEdit,
}: {
  sessions: PlannerSession[];
  plan: PlannerPlan;
  progress: PlannerProgress;
  onToggle: (s: PlannerSession, t: PlannerTask) => void;
  onToggleRow: (s: PlannerSession) => void;
  onEdit: (s: PlannerSession) => void;
}) {
  if (sessions.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-400">
        Nothing in this week.
      </p>
    );
  }
  let lastWeek = -1;
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            <th className="px-3 py-2 text-left">Session</th>
            {plan.tasks.map((t) => (
              <th key={t.id} className="px-2 py-2 text-center" title={t.label}>
                {t.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const newWeek = s.week !== lastWeek;
            lastWeek = s.week;
            const complete = sessionCompletion(progress, s, plan.tasks) === 1;
            const isExam = s.kind === "assessment";
            return (
              <tr
                key={s.id}
                className={`border-b border-slate-100 last:border-b-0 ${
                  isExam ? "bg-red-50/60" : complete ? "bg-emerald-50/40" : ""
                } ${newWeek ? "border-t-2 border-t-slate-200" : ""}`}
              >
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-12 shrink-0 text-[11px] font-bold text-slate-400">
                      Wk {s.week}
                    </span>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                        KIND_STYLES[s.kind] ?? KIND_STYLES.other
                      }`}
                    >
                      {SESSION_LABELS[s.kind]}
                    </span>
                    <button
                      onClick={() => onToggleRow(s)}
                      title={
                        complete
                          ? "Clear this whole row"
                          : "Tick everything for this session"
                      }
                      className={`min-w-0 truncate text-left font-medium hover:underline ${
                        isExam ? "text-red-800" : "text-slate-800"
                      }`}
                    >
                      {s.topic}
                    </button>
                    <span className="shrink-0 text-[11px] text-slate-400">
                      {whenLabel(s)}
                    </span>
                    <button
                      onClick={() => onEdit(s)}
                      aria-label={`Edit ${s.topic}`}
                      title="Fix what the import guessed"
                      className="shrink-0 text-slate-200 transition hover:text-slate-500"
                    >
                      <Pencil size={12} />
                    </button>
                  </div>
                </td>
                {plan.tasks.map((t) => {
                  const done = isDone(progress, s.id, t.id);
                  return (
                    <td key={t.id} className="px-2 py-2 text-center">
                      <button
                        onClick={() => onToggle(s, t)}
                        aria-label={`${t.label} — ${s.topic}`}
                        aria-pressed={done}
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-md border transition ${
                          done
                            ? "border-emerald-400 bg-emerald-500 text-white"
                            : "border-slate-300 bg-white text-transparent hover:border-indigo-400 hover:bg-indigo-50"
                        }`}
                      >
                        <Check size={13} />
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

