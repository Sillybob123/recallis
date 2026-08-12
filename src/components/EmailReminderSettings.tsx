import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Loader2,
  Mail,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { fetchEmailSettings, saveEmailSettings } from "../lib/firestore";
import {
  DEFAULT_EMAIL_SETTINGS,
  describeSchedule,
  detectTimeZone,
  formatTime,
  localDate,
  previewToday,
  WEEKDAY_NAMES,
  type CustomReminder,
  type EmailSettings,
  type RepeatKind,
} from "../lib/emailReminders";
import type { PlannerPlan, PlannerProgress } from "../lib/planner";
import { uid as newId } from "../lib/uid";

const REPEATS: { id: RepeatKind; label: string }[] = [
  { id: "once", label: "Once" },
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Weekdays" },
  { id: "weekly", label: "Weekly" },
];

const LEAD_CHOICES = [14, 7, 3, 1];

function minutesToTime(m: number): string {
  return formatTime(m);
}
function timeToMinutes(v: string): number | null {
  const [h, m] = v.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function Toggle({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      className="flex w-full items-start gap-3 text-left"
      aria-pressed={on}
    >
      <span
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${
          on ? "bg-indigo-600" : "bg-slate-300"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white shadow transition ${
            on ? "translate-x-4" : ""
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        {hint && (
          <span className="block text-xs leading-relaxed text-slate-500">{hint}</span>
        )}
      </span>
    </button>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
        on
          ? "bg-indigo-600 text-white"
          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Everything about the emails, in one place: whether they go at all, what
 * arrives on a schedule, and the one-off nudges you set yourself.
 *
 * The panel deliberately shows what today's email would actually say. A
 * reminder you can't picture is a reminder you don't trust, and a preview is
 * cheaper than sending yourself three test emails.
 */
export function EmailReminderSettings({
  uid,
  accountEmail,
  plan,
  progress,
  onClose,
}: {
  uid: string;
  accountEmail: string;
  plan: PlannerPlan | null;
  progress: PlannerProgress;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<Omit<CustomReminder, "id">>(() => ({
    title: "",
    note: "",
    date: localDate(Date.now(), detectTimeZone()),
    atMinutes: 18 * 60,
    repeat: "once",
    enabled: true,
  }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await fetchEmailSettings(uid).catch(() => null);
      if (cancelled) return;
      setSettings({
        ...DEFAULT_EMAIL_SETTINGS,
        ...(stored ?? {}),
        // The account address is the sensible default, and the zone is only
        // ever detected here — the sender has no idea where you are.
        email: stored?.email || accountEmail || "",
        timeZone: stored?.timeZone || detectTimeZone(),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [uid, accountEmail]);

  const patch = (p: Partial<EmailSettings>) => {
    setSaved(false);
    setSettings((s) => (s ? { ...s, ...p } : s));
  };

  const preview = useMemo(
    () => (settings ? previewToday(settings, plan, progress) : []),
    [settings, plan, progress]
  );

  async function save(extra: Partial<EmailSettings> = {}) {
    if (!settings) return;
    const next = { ...settings, ...extra };
    if (next.enabled && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next.email.trim())) {
      setError("That doesn't look like an email address.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveEmailSettings(uid, { ...next, email: next.email.trim() });
      setSettings(next);
      setSaved(true);
    } catch {
      setError("Couldn't save — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
        <Loader2 className="animate-spin text-white" />
      </div>
    );
  }

  const addCustom = () => {
    if (!draft.title.trim()) return;
    patch({
      custom: [...settings.custom, { ...draft, id: newId(), title: draft.title.trim() }],
    });
    setDraft({ ...draft, title: "", note: "" });
  };

  const s = settings;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
      <div className="my-4 w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Mail size={18} className="text-indigo-600" /> Email reminders
            </h2>
            <p className="text-sm text-slate-500">
              What gets sent, when, and what it's about.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {/* master switch */}
          <div className="rounded-xl border border-slate-200 p-4">
            <Toggle
              on={s.enabled}
              onChange={(v) => patch({ enabled: v })}
              label="Send me email reminders"
              hint="Everything below only happens while this is on."
            />
            {s.enabled && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-500">
                    Send to
                  </span>
                  <input
                    type="email"
                    value={s.email}
                    onChange={(e) => patch({ email: e.target.value })}
                    placeholder="you@university.edu"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  />
                </label>
                <div>
                  <span className="mb-1 block text-xs font-semibold text-slate-500">
                    Your timezone
                  </span>
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {s.timeZone}
                  </p>
                </div>
              </div>
            )}
          </div>

          {s.enabled && (
            <>
              {/* the scheduled ones */}
              <section className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">
                  On a schedule
                </h3>

                <div className="rounded-xl border border-slate-200 p-4">
                  <Toggle
                    on={s.daily.enabled}
                    onChange={(v) => patch({ daily: { ...s.daily, enabled: v } })}
                    label="Daily — what's still open"
                    hint="The sessions from today you haven't finished, and what's worth previewing for tomorrow."
                  />
                  {s.daily.enabled && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
                      <input
                        type="time"
                        value={minutesToTime(s.daily.atMinutes)}
                        onChange={(e) => {
                          const m = timeToMinutes(e.target.value);
                          if (m !== null) patch({ daily: { ...s.daily, atMinutes: m } });
                        }}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-sm tabular-nums outline-none focus:border-indigo-400"
                      />
                      <div className="flex flex-wrap gap-1">
                        {WEEKDAY_NAMES.map((name, i) => (
                          <Chip
                            key={name}
                            on={s.daily.days.includes(i)}
                            onClick={() =>
                              patch({
                                daily: {
                                  ...s.daily,
                                  days: s.daily.days.includes(i)
                                    ? s.daily.days.filter((d) => d !== i)
                                    : [...s.daily.days, i],
                                },
                              })
                            }
                          >
                            {name.slice(0, 3)}
                          </Chip>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <Toggle
                    on={s.weekly.enabled}
                    onChange={(v) => patch({ weekly: { ...s.weekly, enabled: v } })}
                    label="Weekly — the week ahead"
                    hint="Every session of the coming week, plus anything from the last fortnight still unfinished."
                  />
                  {s.weekly.enabled && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
                      <select
                        value={s.weekly.weekday}
                        onChange={(e) =>
                          patch({
                            weekly: { ...s.weekly, weekday: Number(e.target.value) },
                          })
                        }
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-400"
                      >
                        {WEEKDAY_NAMES.map((name, i) => (
                          <option key={name} value={i}>
                            {name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="time"
                        value={minutesToTime(s.weekly.atMinutes)}
                        onChange={(e) => {
                          const m = timeToMinutes(e.target.value);
                          if (m !== null) patch({ weekly: { ...s.weekly, atMinutes: m } });
                        }}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-sm tabular-nums outline-none focus:border-indigo-400"
                      />
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <Toggle
                    on={s.exam.enabled}
                    onChange={(v) => patch({ exam: { ...s.exam, enabled: v } })}
                    label="Before every assessment"
                    hint="Which sessions it covers, and which of them still have unfinished work."
                  />
                  {s.exam.enabled && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 pl-12">
                      <span className="text-xs text-slate-500">Send</span>
                      {LEAD_CHOICES.map((d) => (
                        <Chip
                          key={d}
                          on={s.exam.leadDays.includes(d)}
                          onClick={() =>
                            patch({
                              exam: {
                                ...s.exam,
                                leadDays: s.exam.leadDays.includes(d)
                                  ? s.exam.leadDays.filter((x) => x !== d)
                                  : [...s.exam.leadDays, d],
                              },
                            })
                          }
                        >
                          {d} day{d === 1 ? "" : "s"} out
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* which columns matter */}
              {plan && plan.tasks.length > 0 && (
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                    Which steps to chase
                  </h3>
                  <p className="mb-2 text-xs leading-relaxed text-slate-500">
                    Only these count as "unfinished" in the emails. Leave them all
                    on to chase the whole routine.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {plan.tasks.map((t) => {
                      const on =
                        s.taskIds.length === 0 || s.taskIds.includes(t.id);
                      return (
                        <Chip
                          key={t.id}
                          on={on}
                          onClick={() => {
                            const current =
                              s.taskIds.length === 0
                                ? plan.tasks.map((x) => x.id)
                                : s.taskIds;
                            const next = current.includes(t.id)
                              ? current.filter((x) => x !== t.id)
                              : [...current, t.id];
                            patch({
                              taskIds:
                                next.length === plan.tasks.length ? [] : next,
                            });
                          }}
                        >
                          {t.short}
                        </Chip>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* your own reminders */}
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                  <CalendarClock size={13} /> Reminders you set yourself
                </h3>
                {s.custom.length > 0 && (
                  <ul className="mb-3 space-y-2">
                    {s.custom.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-start gap-2 rounded-xl border border-slate-200 px-3 py-2"
                      >
                        <button
                          onClick={() =>
                            patch({
                              custom: s.custom.map((x) =>
                                x.id === r.id ? { ...x, enabled: !x.enabled } : x
                              ),
                            })
                          }
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                            r.enabled
                              ? "border-emerald-400 bg-emerald-500 text-white"
                              : "border-slate-300 bg-white text-transparent"
                          }`}
                          aria-label={r.enabled ? "Turn off" : "Turn on"}
                        >
                          <Check size={12} />
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800">
                            {r.title}
                          </p>
                          <p className="text-xs text-slate-500">
                            {REPEATS.find((x) => x.id === r.repeat)?.label} ·{" "}
                            {r.repeat === "once" ? r.date : `from ${r.date}`} ·{" "}
                            {minutesToTime(r.atMinutes)}
                            {r.taskId &&
                              ` · lists what's left under "${
                                plan?.tasks.find((t) => t.id === r.taskId)?.short ??
                                r.taskId
                              }"`}
                          </p>
                          {r.note && (
                            <p className="mt-0.5 text-xs text-slate-400">{r.note}</p>
                          )}
                        </div>
                        <button
                          onClick={() =>
                            patch({ custom: s.custom.filter((x) => x.id !== r.id) })
                          }
                          className="shrink-0 text-slate-300 hover:text-red-500"
                          aria-label="Remove"
                        >
                          <Trash2 size={15} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="rounded-xl border border-dashed border-slate-300 p-3">
                  <input
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    placeholder="Remind me to… e.g. redraw the brachial plexus"
                    className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  />
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      value={draft.date}
                      onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-400"
                    />
                    <input
                      type="time"
                      value={minutesToTime(draft.atMinutes)}
                      onChange={(e) => {
                        const m = timeToMinutes(e.target.value);
                        if (m !== null) setDraft({ ...draft, atMinutes: m });
                      }}
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-indigo-400"
                    />
                    <select
                      value={draft.repeat}
                      onChange={(e) =>
                        setDraft({ ...draft, repeat: e.target.value as RepeatKind })
                      }
                      className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-400"
                    >
                      {REPEATS.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    {plan && plan.tasks.length > 0 && (
                      <select
                        value={draft.taskId ?? ""}
                        onChange={(e) =>
                          setDraft({ ...draft, taskId: e.target.value || undefined })
                        }
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-400"
                      >
                        <option value="">No list attached</option>
                        {plan.tasks.map((t) => (
                          <option key={t.id} value={t.id}>
                            List what's left: {t.short}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <input
                      value={draft.note ?? ""}
                      onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                      placeholder="A line to yourself (optional)"
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
                    />
                    <button
                      onClick={addCustom}
                      disabled={!draft.title.trim()}
                      className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-40"
                    >
                      <Plus size={14} /> Add
                    </button>
                  </div>
                </div>
              </section>

              {/* what it'll say */}
              <section className="rounded-xl bg-slate-50 p-4">
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                  What you'll get
                </h3>
                <ul className="mb-3 space-y-1">
                  {describeSchedule(s).map((line) => (
                    <li key={line} className="text-sm text-slate-600">
                      · {line}
                    </li>
                  ))}
                </ul>
                {preview.length > 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                      Today's email would say
                    </p>
                    <p className="mt-1 text-sm font-bold text-slate-800">
                      {preview[0].heading}
                    </p>
                    <p className="text-xs text-slate-500">{preview[0].intro}</p>
                    {preview[0].sections.map((sec) => (
                      <div key={sec.title} className="mt-2">
                        <p className="text-[11px] font-semibold text-slate-500">
                          {sec.title}
                        </p>
                        <ul className="mt-0.5 space-y-0.5">
                          {sec.lines.slice(0, 4).map((l) => (
                            <li key={l.title} className="text-xs text-slate-600">
                              • {l.title}
                              {l.steps && (
                                <span className="text-slate-400">
                                  {" — "}
                                  {l.steps.filter((x) => !x.done).length} left
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    Nothing scheduled today, so no daily email would go out —
                    they're only sent when there's something to say.
                  </p>
                )}
              </section>

              <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  Emails are sent by a job that runs every half hour, so one
                  scheduled for 18:00 arrives shortly after — not to the minute.
                  Nothing is ever sent twice.
                </span>
              </p>
            </>
          )}

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
          {s.enabled ? (
            <button
              onClick={() => save({ testRequested: Date.now() })}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600"
              title="Sends one example email on the next run"
            >
              <Send size={14} /> Save &amp; send me a test
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {saved && (
              <span className="text-xs font-semibold text-emerald-600">Saved</span>
            )}
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
            >
              Close
            </button>
            <button
              onClick={() => save()}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              Save settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
