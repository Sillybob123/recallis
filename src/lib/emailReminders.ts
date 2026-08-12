// Scheduled email reminders for the planner.
//
// Everything here is pure: given someone's settings, their plan, their
// progress and the current instant, it decides which emails are due and what
// each one should say. The browser uses it to preview and describe the
// schedule; the Cloudflare Worker in worker/src/index.ts uses the same
// functions to decide what to actually deliver. One source of truth, and the
// decision is testable without a mail server.
//
// Times are always the user's local wall clock. Someone who asks for 18:00
// means 18:00 where they are, so every comparison goes through their IANA
// timezone rather than the machine the sender happens to run on.

import {
  isDone,
  sessionCompletion,
  type PlannerPlan,
  type PlannerProgress,
  type PlannerSession,
  type PlannerTask,
} from "./planner";

export type RepeatKind = "once" | "daily" | "weekdays" | "weekly";

export interface CustomReminder {
  id: string;
  title: string;
  note?: string;
  /** local wall-clock date, yyyy-mm-dd: the first (or only) day it fires */
  date: string;
  /** minutes past local midnight */
  atMinutes: number;
  repeat: RepeatKind;
  enabled: boolean;
  /** optional routine column this is about, so the email can list what's left */
  taskId?: string;
}

export interface EmailSettings {
  enabled: boolean;
  email: string;
  /** IANA zone, e.g. "Europe/Budapest" */
  timeZone: string;
  /**
   * Only write when something is actually unfinished. On by default: an
   * email that arrives whether or not you did the work stops being read.
   */
  onlyWhenBehind: boolean;
  /** the daily nudge, and the time of day everything scheduled goes out */
  daily: { enabled: boolean; atMinutes: number; days: number[] };
  /** the week-ahead plan */
  weekly: { enabled: boolean; weekday: number; atMinutes: number };
  /** how many days before an assessment to write */
  exam: { enabled: boolean; leadDays: number[] };
  /** routine columns worth chasing; empty means all of them */
  taskIds: string[];
  custom: CustomReminder[];
  /** dedupe keys → when they were sent, so nothing goes twice */
  sent: Record<string, number>;
  /** set from the settings screen; the next run sends one example and clears it */
  testRequested?: number;
  updatedAt: number;
}

export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  enabled: false,
  email: "",
  timeZone: "UTC",
  onlyWhenBehind: true,
  daily: { enabled: true, atMinutes: 18 * 60, days: [1, 2, 3, 4, 5] },
  weekly: { enabled: true, weekday: 0, atMinutes: 17 * 60 },
  exam: { enabled: true, leadDays: [7, 3, 1] },
  taskIds: [],
  custom: [],
  sent: {},
  updatedAt: 0,
};

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---------- local time ----------

/** yyyy-mm-dd in the given zone. en-CA formats exactly that way. */
export function localDate(at: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(at));
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(at));
  }
}

/** Minutes past local midnight in the given zone. */
export function localMinutes(at: number, timeZone: string): number {
  const fmt = (tz?: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(at));
  let text: string;
  try {
    text = fmt(timeZone);
  } catch {
    text = fmt(undefined);
  }
  const [h, m] = text.split(":").map(Number);
  return h * 60 + m;
}

/** 0 = Sunday, matching Date.getDay(). */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whole days from one yyyy-mm-dd to another, calendar-wise. */
export function daysBetween(from: string, to: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86400000);
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(
    t.getUTCDate()
  ).padStart(2, "0")}`;
}

export function prettyDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

// ---------- what an email contains ----------

export interface EmailStep {
  label: string;
  done: boolean;
}
export interface EmailLine {
  title: string;
  meta?: string;
  steps?: EmailStep[];
}
export interface EmailSection {
  title: string;
  tone?: "normal" | "alert" | "good";
  note?: string;
  lines: EmailLine[];
}
export interface EmailJob {
  kind: "daily" | "weekly" | "exam" | "custom";
  /** dedupe key: the same key never sends twice */
  key: string;
  subject: string;
  heading: string;
  intro: string;
  sections: EmailSection[];
}

function tasksToChase(plan: PlannerPlan, settings: EmailSettings): PlannerTask[] {
  if (settings.taskIds.length === 0) return plan.tasks;
  const wanted = new Set(settings.taskIds);
  const picked = plan.tasks.filter((t) => wanted.has(t.id));
  return picked.length ? picked : plan.tasks;
}

function stepsFor(
  progress: PlannerProgress,
  session: PlannerSession,
  tasks: PlannerTask[]
): EmailStep[] {
  return tasks.map((t) => ({
    label: t.short,
    done: isDone(progress, session.id, t.id),
  }));
}

function timeOfSession(s: PlannerSession, timeZone: string): string {
  if (s.allDay) return "all day";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(s.start));
  } catch {
    return "";
  }
}

function sessionsOn(
  sessions: PlannerSession[],
  timeZone: string,
  dateStr: string
): PlannerSession[] {
  return sessions
    .filter((s) => localDate(s.start, timeZone) === dateStr)
    .sort((a, b) => a.start - b.start);
}

function lineFor(
  s: PlannerSession,
  progress: PlannerProgress,
  tasks: PlannerTask[],
  timeZone: string,
  withDate = false
): EmailLine {
  const when = timeOfSession(s, timeZone);
  const day = withDate ? prettyDate(localDate(s.start, timeZone)) : "";
  return {
    title: s.topic,
    meta: [day, when, s.location].filter(Boolean).join(" · "),
    steps: stepsFor(progress, s, tasks),
  };
}

// ---------- deciding what's due ----------

function alreadySent(settings: EmailSettings, key: string): boolean {
  return settings.sent[key] !== undefined;
}

/**
 * The emails that should go out right now.
 *
 * Every job carries a dedupe key, so a sender that runs late — or twice —
 * still delivers each reminder exactly once. That matters more than firing
 * at the exact minute: a scheduled job is never punctual, but it must never
 * double-send.
 */
export function dueEmails(
  settings: EmailSettings,
  plan: PlannerPlan | null,
  progress: PlannerProgress,
  now: number
): EmailJob[] {
  if (!settings.enabled || !settings.email) return [];
  const tz = settings.timeZone || "UTC";
  const today = localDate(now, tz);
  const minutes = localMinutes(now, tz);
  const weekday = weekdayOf(today);
  const jobs: EmailJob[] = [];
  const sessions = plan?.sessions ?? [];
  const tasks = plan ? tasksToChase(plan, settings) : [];

  // --- the daily nudge ---
  if (
    plan &&
    settings.daily.enabled &&
    settings.daily.days.includes(weekday) &&
    minutes >= settings.daily.atMinutes &&
    !alreadySent(settings, `daily-${today}`)
  ) {
    const todays = sessionsOn(sessions, tz, today);
    const tomorrows = sessionsOn(sessions, tz, addDays(today, 1));
    const unfinished = todays.filter(
      (s) => sessionCompletion(progress, s, tasks) < 1
    );
    // Everything today ticked, and they asked only to hear when it isn't:
    // the whole email is skipped, tomorrow's preview included. An email that
    // arrives whether or not you did the work stops being read.
    const quiet = unfinished.length === 0 && settings.onlyWhenBehind;
    const sections: EmailSection[] = [];
    if (unfinished.length) {
      sections.push({
        title: "Still open from today",
        tone: "alert",
        lines: unfinished.map((s) => lineFor(s, progress, tasks, tz)),
      });
    } else if (todays.length && !quiet) {
      sections.push({
        title: "Today",
        tone: "good",
        note: "Every session from today is ticked off. That's the whole game.",
        lines: todays.map((s) => lineFor(s, progress, tasks, tz)),
      });
    }
    if (tomorrows.length && !quiet) {
      sections.push({
        title: "Tomorrow — worth previewing tonight",
        lines: tomorrows.map((s) => lineFor(s, progress, tasks, tz)),
      });
    }
    if (sections.length) {
      const n = unfinished.length;
      jobs.push({
        kind: "daily",
        key: `daily-${today}`,
        subject: n
          ? `${n} session${n === 1 ? "" : "s"} still open from today`
          : tomorrows.length
            ? `Today's clear — ${tomorrows.length} to preview for tomorrow`
            : "Today's clear",
        heading: n
          ? `${n} thing${n === 1 ? "" : "s"} left`
          : "You're on top of it",
        intro: n
          ? "Twenty minutes now is worth an hour the night before an exam. Pick the top one."
          : "Nothing outstanding from today. Get ahead on tomorrow and tonight is yours.",
        sections,
      });
    }
  }

  // --- the week ahead ---
  if (
    plan &&
    settings.weekly.enabled &&
    weekday === settings.weekly.weekday &&
    minutes >= settings.weekly.atMinutes &&
    !alreadySent(settings, `weekly-${today}`)
  ) {
    const lines: EmailLine[] = [];
    for (let i = 0; i < 7; i++) {
      for (const s of sessionsOn(sessions, tz, addDays(today, i))) {
        lines.push(lineFor(s, progress, tasks, tz, true));
      }
    }
    const behind = sessions
      .filter((s) => {
        const gap = daysBetween(localDate(s.start, tz), today);
        return gap > 0 && gap <= 14 && s.kind !== "assessment";
      })
      .filter((s) => sessionCompletion(progress, s, tasks) < 1);

    if (lines.length || behind.length) {
      const sections: EmailSection[] = [];
      if (behind.length) {
        sections.push({
          title: `${behind.length} from the last fortnight still unfinished`,
          tone: "alert",
          note: "Oldest first — those are the ones you've had longest to forget.",
          lines: behind
            .slice(0, 8)
            .map((s) => lineFor(s, progress, tasks, tz, true)),
        });
      }
      if (lines.length) {
        sections.push({ title: "The week ahead", lines: lines.slice(0, 40) });
      }
      jobs.push({
        kind: "weekly",
        key: `weekly-${today}`,
        subject: `Your week: ${lines.length} session${lines.length === 1 ? "" : "s"}${
          behind.length ? `, ${behind.length} to catch up` : ""
        }`,
        heading: "The week ahead",
        intro:
          "Ten minutes deciding when each of these gets studied is the difference between a planned week and a reactive one.",
        sections,
      });
    }
  }

  // --- assessments coming up ---
  if (plan && settings.exam.enabled && minutes >= settings.daily.atMinutes) {
    const exams = sessions
      .filter((s) => s.kind === "assessment")
      .sort((a, b) => a.start - b.start);
    let previousAt = -Infinity;
    for (const exam of exams) {
      const covers = sessions.filter(
        (s) =>
          s.kind !== "assessment" &&
          s.start > previousAt &&
          s.start <= exam.start
      );
      previousAt = exam.start;
      const away = daysBetween(today, localDate(exam.start, tz));
      if (!settings.exam.leadDays.includes(away)) continue;
      const key = `exam-${exam.id}-${away}`;
      if (alreadySent(settings, key)) continue;
      const outstanding = covers.filter(
        (s) => sessionCompletion(progress, s, tasks) < 1
      );
      // Nothing outstanding and they only want chasing: stay quiet.
      if (outstanding.length === 0 && settings.onlyWhenBehind) continue;
      jobs.push({
        kind: "exam",
        key,
        subject: `${exam.topic} is in ${away} day${away === 1 ? "" : "s"}${
          outstanding.length ? ` — ${outstanding.length} sessions unfinished` : ""
        }`,
        heading: `${away} day${away === 1 ? "" : "s"} to ${exam.topic}`,
        intro: outstanding.length
          ? `It covers ${covers.length} sessions, and ${outstanding.length} of them still have work on them. Here they are, oldest first.`
          : `It covers ${covers.length} sessions and every one of them is finished. Spend the time on recall, not on new material.`,
        sections: outstanding.length
          ? [
              {
                title: "Unfinished, oldest first",
                tone: "alert",
                lines: outstanding
                  .slice(0, 15)
                  .map((s) => lineFor(s, progress, tasks, tz, true)),
              },
            ]
          : [
              {
                title: "You're ready",
                tone: "good",
                note: "Test yourself on it rather than reading it again.",
                lines: [],
              },
            ],
      });
    }
  }

  // --- reminders you set yourself ---
  for (const r of settings.custom) {
    if (!r.enabled || !r.title.trim()) continue;
    if (today < r.date) continue;
    if (minutes < r.atMinutes) continue;
    const fires =
      r.repeat === "once"
        ? true
        : r.repeat === "daily"
          ? true
          : r.repeat === "weekdays"
            ? weekday >= 1 && weekday <= 5
            : weekday === weekdayOf(r.date);
    if (!fires) continue;
    const key = r.repeat === "once" ? `custom-${r.id}` : `custom-${r.id}-${today}`;
    if (alreadySent(settings, key)) continue;

    const sections: EmailSection[] = [];
    const task = plan?.tasks.find((t) => t.id === r.taskId);
    if (task) {
      const behind = sessions
        .filter(
          (s) =>
            s.kind !== "assessment" &&
            !isDone(progress, s.id, task.id) &&
            daysBetween(localDate(s.start, tz), today) >= 0
        )
        .sort((a, b) => a.start - b.start)
        .slice(0, 10);
      sections.push(
        behind.length
          ? {
              title: `${task.label} — still outstanding`,
              tone: "alert",
              lines: behind.map((s) => lineFor(s, progress, tasks, tz, true)),
            }
          : {
              title: `${task.label} — all caught up`,
              tone: "good",
              note: "Nothing outstanding on this one.",
              lines: [],
            }
      );
    }
    jobs.push({
      kind: "custom",
      key,
      subject: r.title.trim(),
      heading: r.title.trim(),
      intro:
        r.note?.trim() ||
        "You asked to be reminded about this. Two minutes deciding when it happens today beats an hour of meaning to.",
      sections,
    });
  }

  return jobs;
}

/** Keys older than this are dropped, so the document can't grow forever. */
const SENT_KEEP_MS = 120 * 86400000;

export function pruneSent(
  sent: Record<string, number>,
  now = Date.now()
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(sent)) {
    if (now - v < SENT_KEEP_MS) out[k] = v;
  }
  return out;
}

/**
 * A plain-language description of the schedule, so the settings screen can
 * say exactly what will arrive rather than leaving it to be discovered.
 */
export function describeSchedule(settings: EmailSettings): string[] {
  if (!settings.enabled) return ["No emails are being sent."];
  const out: string[] = [];
  if (settings.daily.enabled && settings.daily.days.length) {
    const days =
      settings.daily.days.length === 7
        ? "every day"
        : settings.daily.days.length === 5 &&
            [1, 2, 3, 4, 5].every((d) => settings.daily.days.includes(d))
          ? "on weekdays"
          : `on ${settings.daily.days
              .slice()
              .sort()
              .map((d) => WEEKDAY_NAMES[d].slice(0, 3))
              .join(", ")}`;
    out.push(
      `What's left from today, ${days} at ${formatTime(settings.daily.atMinutes)}` +
        (settings.onlyWhenBehind ? ", and only when something is unfinished." : ".")
    );
  }
  if (settings.weekly.enabled) {
    out.push(
      `The week ahead, every ${WEEKDAY_NAMES[settings.weekly.weekday]} at ${formatTime(
        settings.weekly.atMinutes
      )}.`
    );
  }
  if (settings.exam.enabled && settings.exam.leadDays.length) {
    const days = settings.exam.leadDays.slice().sort((a, b) => b - a);
    out.push(
      `Before every assessment: ${days.map((d) => `${d} day${d === 1 ? "" : "s"}`).join(", ")} out.`
    );
  }
  const live = settings.custom.filter((r) => r.enabled).length;
  if (live) out.push(`${live} reminder${live === 1 ? "" : "s"} you set yourself.`);
  if (out.length === 0) out.push("Email is on, but nothing is scheduled yet.");
  return out;
}

/** Kept for the preview panel: what today would produce, right now. */
export function previewToday(
  settings: EmailSettings,
  plan: PlannerPlan | null,
  progress: PlannerProgress,
  now = Date.now()
): EmailJob[] {
  // The preview ignores both the clock and what's already been sent — it
  // answers "what would today's email say", not "is one due this second".
  const tz = settings.timeZone || "UTC";
  const today = localDate(now, tz);
  const forced: EmailSettings = {
    ...settings,
    enabled: true,
    email: settings.email || "preview@example.com",
    sent: {},
    daily: {
      ...settings.daily,
      enabled: true,
      atMinutes: 0,
      days: [weekdayOf(today)],
    },
    weekly: { ...settings.weekly, enabled: false },
    exam: { ...settings.exam, enabled: false },
    custom: [],
  };
  return dueEmails(forced, plan, progress, now);
}

/** Used by the sender's summary line, and by the tests. */
export function jobSummary(job: EmailJob): string {
  const lines = job.sections.reduce((n, s) => n + s.lines.length, 0);
  return `${job.kind}: ${job.subject} (${lines} lines)`;
}
