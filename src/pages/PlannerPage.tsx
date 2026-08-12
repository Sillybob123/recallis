import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BellOff,
  CalendarPlus,
  Check,
  Loader2,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Layout } from "../components/Layout";
import {
  fetchPlannerPlan,
  fetchPlannerProgress,
  savePlannerPlan,
  setPlannerProgress,
  setPlannerProgressBulk,
} from "../lib/firestore";
import { parseIcs } from "../lib/ics";
import {
  agendaFor,
  DEFAULT_TASKS,
  examOutlook,
  isDone,
  makeTaskId,
  progressKey,
  SESSION_LABELS,
  sessionCompletion,
  sessionsFromEvents,
  TASK_PRESETS,
  upcomingExams,
  type PlannerPlan,
  type PlannerProgress,
  type PlannerSession,
  type PlannerTask,
} from "../lib/planner";
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
function timeLabel(s: PlannerSession): string {
  if (s.allDay) return "all day";
  return new Date(s.start).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PlannerPage() {
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
      setPlan(p);
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

  if (loading) {
    return (
      <Layout>
        <div className="py-24 text-center text-slate-400">Loading your planner…</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {plan?.name || "Academic planner"}
          </h1>
          <p className="text-sm text-slate-500">
            Your timetable, the routine you run on each session, and what's
            actually done.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setEditingRoutine(true)}
            title="Choose the columns — the routine you run on every session"
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <SlidersHorizontal size={14} /> Routine
          </button>
          <div
            className={`flex items-center gap-1.5 rounded-lg border text-sm font-medium transition ${
              reminders.enabled
                ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                : "border-slate-300 bg-white text-slate-600"
            }`}
          >
            <button
              onClick={toggleReminders}
              title={
                reminders.enabled
                  ? "Reminders on — turn them off"
                  : "Get a daily nudge about what's left"
              }
              className="flex items-center gap-1.5 py-1.5 pl-3 hover:opacity-80"
            >
              {reminders.enabled ? <Bell size={14} /> : <BellOff size={14} />}
              Reminders
            </button>
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
              title="When to remind you, on the days you have Recallis open"
              className="mr-1.5 rounded border-none bg-transparent py-1 text-xs tabular-nums outline-none"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CalendarPlus size={14} />
            )}
            {busy ?? (plan ? "Re-import .ics" : "Import timetable (.ics)")}
            <input
              ref={fileRef}
              type="file"
              accept=".ics,text/calendar"
              className="hidden"
              disabled={Boolean(busy)}
              onChange={(e) => e.target.files?.[0] && importIcs(e.target.files[0])}
            />
          </label>
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
            <section className="mb-4 space-y-2">
              {soon.map((e) => (
                <div
                  key={e.session.id}
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3"
                >
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-red-800">
                    <AlertTriangle size={15} />
                    {e.session.topic}
                    <span className="font-medium">
                      {e.daysAway === 0
                        ? "is today"
                        : e.daysAway === 1
                          ? "is tomorrow"
                          : `is in ${e.daysAway} days`}
                    </span>
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-red-700">
                    It covers <b>{e.covers.length}</b> sessions.{" "}
                    {e.outstanding.length === 0 ? (
                      <>Every one of them is finished — you're ready.</>
                    ) : (
                      <>
                        <b>{e.outstanding.length}</b> still have unfinished
                        work. Start with the oldest: they're the ones you've
                        had longest to forget.
                      </>
                    )}
                  </p>
                  {e.outstanding.length > 0 && (
                    <button
                      onClick={() => setWeekFilter(e.outstanding[0].week)}
                      className="mt-2 rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
                    >
                      Go to week {e.outstanding[0].week}
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}

          <Today
            agenda={agenda}
            plan={plan}
            progress={progress}
            onToggle={toggle}
          />

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
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
          />

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <span>
              {plan.sessions.length} sessions ·{" "}
              {plan.sessions.filter((s) => s.kind === "assessment").length}{" "}
              assessments
            </span>
            <button
              onClick={async () => {
                if (!user) return;
                if (!confirm("Remove the imported timetable? Your ticks are kept.")) return;
                const cleared: PlannerPlan = {
                  ...plan,
                  sessions: [],
                  updatedAt: Date.now(),
                };
                await savePlannerPlan(user.uid, cleared);
                setPlan(cleared);
              }}
              className="flex items-center gap-1 hover:text-red-500"
            >
              <Trash2 size={12} /> Clear timetable
            </button>
          </div>
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
}: {
  sessions: PlannerSession[];
  plan: PlannerPlan;
  progress: PlannerProgress;
  onToggle: (s: PlannerSession, t: PlannerTask) => void;
  onToggleRow: (s: PlannerSession) => void;
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
                      {dayLabel(s.start)} · {timeLabel(s)}
                    </span>
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

