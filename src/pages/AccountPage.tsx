import { useEffect, useMemo, useState } from "react";
import { updateProfile } from "firebase/auth";
import {
  Bell,
  Check,
  Flame,
  Layers,
  Loader2,
  Mail,
  Pencil,
  Timer,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Layout } from "../components/Layout";
import { EmailReminderSettings } from "../components/EmailReminderSettings";
import {
  fetchEmailSettings,
  fetchPlannerPlan,
  fetchPlannerProgress,
  getRevlogSince,
  watchDecks,
} from "../lib/firestore";
import { computeAllDeckCounts, type DeckCounts } from "../lib/deckCounts";
import {
  activityLevel,
  addDays,
  formatDuration,
  summarizeReviews,
  type StudyStats,
} from "../lib/stats";
import {
  DEFAULT_EMAIL_SETTINGS,
  describeSchedule,
  type EmailSettings,
} from "../lib/emailReminders";
import type { PlannerPlan, PlannerProgress } from "../lib/planner";
import type { Deck } from "../types";

const WINDOW_DAYS = 84; // twelve weeks, which is a semester's shape

export function AccountPage() {
  const { user } = useAuth();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [counts, setCounts] = useState<Map<string, DeckCounts>>(new Map());
  const [stats, setStats] = useState<StudyStats | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [email, setEmail] = useState<EmailSettings | null>(null);
  const [plan, setPlan] = useState<PlannerPlan | null>(null);
  const [progress, setProgress] = useState<PlannerProgress>({});
  const [showEmail, setShowEmail] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(user?.displayName ?? "");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (!user) return;
    return watchDecks(user.uid, setDecks);
  }, [user]);

  useEffect(() => {
    if (!user || !decks) return;
    let cancelled = false;
    (async () => {
      const ids = decks.map((d) => d.id);
      const [log, deckCounts, mail, p, pr] = await Promise.all([
        getRevlogSince(user.uid, ids, addDays(Date.now(), -WINDOW_DAYS)).catch(
          () => ({ entries: [], truncated: false })
        ),
        computeAllDeckCounts(user.uid, ids).catch(
          () => new Map<string, DeckCounts>()
        ),
        fetchEmailSettings(user.uid).catch(() => null),
        fetchPlannerPlan(user.uid).catch(() => null),
        fetchPlannerProgress(user.uid).catch(() => ({})),
      ]);
      if (cancelled) return;
      setStats(summarizeReviews(log.entries, WINDOW_DAYS));
      setTruncated(log.truncated);
      setCounts(deckCounts);
      setEmail(mail ?? { ...DEFAULT_EMAIL_SETTINGS });
      setPlan(p);
      setProgress(pr);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, decks]);

  const collection = useMemo(() => {
    let newCount = 0;
    let learn = 0;
    let due = 0;
    for (const c of counts.values()) {
      newCount += c.newRaw;
      learn += c.learnCount;
      due += c.dueRaw;
    }
    return { newCount, learn, due, decks: decks?.length ?? 0 };
  }, [counts, decks]);

  const plannerDone = useMemo(() => {
    if (!plan || plan.sessions.length === 0) return null;
    const total = plan.sessions.length * Math.max(plan.tasks.length, 1);
    const done = Object.values(progress).filter(Boolean).length;
    return { done, total, share: total > 0 ? done / total : 0 };
  }, [plan, progress]);

  async function saveName() {
    if (!user) return;
    const next = nameDraft.trim();
    setEditingName(false);
    if (!next || next === user.displayName) return;
    setSavingName(true);
    try {
      await updateProfile(user, { displayName: next });
    } finally {
      setSavingName(false);
    }
  }

  if (!user) return null;

  return (
    <Layout>
      {showEmail && email && (
        <EmailReminderSettings
          uid={user.uid}
          accountEmail={user.email ?? ""}
          plan={plan}
          progress={progress}
          onClose={() => {
            setShowEmail(false);
            fetchEmailSettings(user.uid)
              .then((s) => s && setEmail(s))
              .catch(() => {});
          }}
        />
      )}

      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">Your account</h1>
        <p className="text-sm text-slate-500">
          Who you are, what gets emailed to you, and how the studying is
          actually going.
        </p>
      </div>

      {/* profile */}
      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
            style={{ backgroundColor: "var(--accent)" }}
          >
            {(user.displayName || user.email || "?").trim().charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            {editingName ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveName();
                    if (e.key === "Escape") setEditingName(false);
                  }}
                  onBlur={() => void saveName()}
                  className="min-w-0 rounded-lg border border-slate-300 px-2 py-1 text-lg font-bold outline-none focus:border-indigo-400"
                />
                <button onClick={() => void saveName()} className="text-emerald-600">
                  <Check size={18} />
                </button>
              </div>
            ) : (
              <p className="group flex items-center gap-2 text-lg font-bold text-slate-900">
                {user.displayName || "Add your name"}
                <button
                  onClick={() => {
                    setNameDraft(user.displayName ?? "");
                    setEditingName(true);
                  }}
                  aria-label="Change your name"
                  className="text-slate-300 opacity-0 transition group-hover:opacity-100 hover:text-slate-500"
                >
                  <Pencil size={14} />
                </button>
                {savingName && <Loader2 size={14} className="animate-spin text-slate-300" />}
              </p>
            )}
            <p className="truncate text-sm text-slate-500">{user.email}</p>
            {user.metadata.creationTime && (
              <p className="mt-0.5 text-xs text-slate-400">
                Joined{" "}
                {new Date(user.metadata.creationTime).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* notifications */}
      <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Bell size={15} className="text-indigo-600" /> Notifications
            </h2>
            <ul className="mt-1.5 space-y-0.5">
              {(email ? describeSchedule(email) : ["Loading…"]).map((line) => (
                <li key={line} className="text-sm text-slate-600">
                  · {line}
                </li>
              ))}
            </ul>
            {email?.enabled && email.email && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
                <Mail size={12} /> {email.email}
              </p>
            )}
          </div>
          <button
            onClick={() => setShowEmail(true)}
            className="shrink-0 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            {email?.enabled ? "Change" : "Set up"}
          </button>
        </div>
      </section>

      {/* stats */}
      {!stats ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
          <Loader2 size={18} className="mx-auto mb-2 animate-spin" />
          Working out how it's going…
        </div>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              icon={<Flame size={15} />}
              label="Current streak"
              value={stats.streak === 0 ? "—" : `${stats.streak}`}
              unit={stats.streak === 1 ? "day" : "days"}
              note={
                stats.longestStreak > stats.streak
                  ? `Best: ${stats.longestStreak}`
                  : stats.streak > 0
                    ? "Your best yet"
                    : "Study today to start one"
              }
              tone="amber"
            />
            <Stat
              icon={<TrendingUp size={15} />}
              label="Reviews"
              value={stats.totalReviews.toLocaleString()}
              unit={`in ${WINDOW_DAYS} days`}
              note={
                stats.activeDays > 0
                  ? `${Math.round(stats.totalReviews / stats.activeDays)} a day when you study`
                  : "Nothing yet"
              }
              tone="emerald"
            />
            <Stat
              icon={<Check size={15} />}
              label="Recalled"
              value={
                stats.retention === null ? "—" : `${Math.round(stats.retention * 100)}%`
              }
              unit="of answers"
              note={
                stats.retention === null
                  ? "No graded answers yet"
                  : stats.retention >= 0.9
                    ? "Comfortable — you could push the intervals"
                    : stats.retention >= 0.8
                      ? "About right"
                      : "Hard going — smaller steps may help"
              }
              tone="sky"
            />
            <Stat
              icon={<Timer size={15} />}
              label="Time studying"
              value={formatDuration(stats.totalMs)}
              unit={`over ${stats.activeDays} days`}
              note={
                stats.activeDays > 0
                  ? `${formatDuration(stats.totalMs / stats.activeDays)} a day`
                  : ""
              }
              tone="violet"
            />
          </div>

          <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-slate-800">Activity</h2>
            <ActivityGrid stats={stats} />
            {truncated && (
              <p className="mt-3 text-xs text-slate-400">
                You've reviewed more than this page reads in one go, so the
                earliest days of the window are under-counted. Recent weeks
                are complete.
              </p>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
                <Layers size={15} className="text-slate-400" /> Your collection
              </h2>
              <div className="space-y-2">
                <Bar label="New" value={collection.newCount} total={collection.newCount + collection.learn + collection.due} color="bg-sky-500" />
                <Bar label="Learning" value={collection.learn} total={collection.newCount + collection.learn + collection.due} color="bg-orange-500" />
                <Bar label="Due now" value={collection.due} total={collection.newCount + collection.learn + collection.due} color="bg-emerald-600" />
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Across {collection.decks} deck{collection.decks === 1 ? "" : "s"}.
                Cards you've finished for today aren't counted here.
              </p>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-bold text-slate-800">
                How you answer
              </h2>
              <div className="space-y-2">
                {(
                  [
                    ["Again", stats.ratings.again, "bg-red-500"],
                    ["Hard", stats.ratings.hard, "bg-orange-400"],
                    ["Good", stats.ratings.good, "bg-emerald-500"],
                    ["Easy", stats.ratings.easy, "bg-sky-400"],
                  ] as const
                ).map(([label, value, color]) => (
                  <Bar
                    key={label}
                    label={label}
                    value={value}
                    total={
                      stats.ratings.again +
                      stats.ratings.hard +
                      stats.ratings.good +
                      stats.ratings.easy
                    }
                    color={color}
                  />
                ))}
              </div>
              {plannerDone && (
                <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  Planner: <b>{Math.round(plannerDone.share * 100)}%</b> of your
                  routine ticked off ({plannerDone.done} of {plannerDone.total}).
                </p>
              )}
            </section>
          </div>
        </>
      )}
    </Layout>
  );
}

function Stat({
  icon,
  label,
  value,
  unit,
  note,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  note?: string;
  tone: "amber" | "emerald" | "sky" | "violet";
}) {
  const tones = {
    amber: "text-amber-600 bg-amber-50",
    emerald: "text-emerald-600 bg-emerald-50",
    sky: "text-sky-600 bg-sky-50",
    violet: "text-violet-600 bg-violet-50",
  };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        <span className={`rounded-md p-1 ${tones[tone]}`}>{icon}</span>
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">
        {value}
        {unit && (
          <span className="ml-1 text-xs font-medium text-slate-400">{unit}</span>
        )}
      </p>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

/** Twelve weeks of days, a column per week, the way a contribution grid reads. */
function ActivityGrid({ stats }: { stats: StudyStats }) {
  const busiest = stats.busiestDay?.reviews ?? 0;
  const shades = [
    "bg-slate-100",
    "bg-emerald-200",
    "bg-emerald-300",
    "bg-emerald-500",
    "bg-emerald-700",
  ];
  const weeks: (typeof stats.days)[] = [];
  for (let i = 0; i < stats.days.length; i += 7) {
    weeks.push(stats.days.slice(i, i + 7));
  }
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1">
        {weeks.map((week, i) => (
          <div key={i} className="flex flex-col gap-1">
            {week.map((day) => (
              <div
                key={day.key}
                title={`${new Date(day.at).toLocaleDateString(undefined, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })} — ${day.reviews} review${day.reviews === 1 ? "" : "s"}${
                  day.msSpent ? `, ${formatDuration(day.msSpent)}` : ""
                }`}
                className={`h-3.5 w-3.5 rounded-sm ${
                  shades[activityLevel(day.reviews, busiest)]
                }`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
        <span>Less</span>
        {shades.map((s) => (
          <span key={s} className={`h-2.5 w-2.5 rounded-sm ${s}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function Bar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const share = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-slate-500">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${color}`} style={{ width: `${share}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-700">
        {value.toLocaleString()}
      </span>
    </div>
  );
}
