// The academic planner: a semester's sessions, the routine you apply to each
// one, and what you've actually done.
//
// The shape follows the grid students already keep by hand — one row per
// session, one column per step of the routine, a tick in each box. What the
// app adds is knowing when the assessments are and which of the sessions
// before one are still unticked.

import type { IcsEvent } from "./ics";

export type SessionKind =
  | "lecture"
  | "lab"
  | "smallGroup"
  | "patient"
  | "selfStudy"
  | "assessment"
  | "other";

export interface PlannerSession {
  id: string;
  /** 1-based, counted from the week the first session falls in */
  week: number;
  kind: SessionKind;
  topic: string;
  /** epoch ms */
  start: number;
  end?: number;
  allDay: boolean;
  location?: string;
}

export interface PlannerTask {
  id: string;
  label: string;
  /** shown on the grid header; kept short */
  short: string;
}

export interface PlannerPlan {
  name: string;
  tasks: PlannerTask[];
  sessions: PlannerSession[];
  /** how many days before an assessment to start flagging it */
  examLeadDays: number;
  updatedAt: number;
}

export const SESSION_LABELS: Record<SessionKind, string> = {
  lecture: "Lecture",
  lab: "Lab",
  smallGroup: "Small group",
  patient: "Patient",
  selfStudy: "Self study",
  assessment: "Assessment",
  other: "Session",
};

/**
 * The routine most people end up with, and the columns in the grid they keep
 * by hand: see it once before, see it properly, drill it, then prove you can
 * explain it. Editable — this is only the starting point.
 */
export const DEFAULT_TASKS: PlannerTask[] = [
  { id: "preview", label: "Preview the slides beforehand", short: "Preview" },
  { id: "attend", label: "Attend or watch the session", short: "View" },
  { id: "close", label: "Close study — work through the material", short: "Close study" },
  { id: "anki", label: "Anki made and reviewed", short: "Anki" },
  { id: "questions", label: "Practice questions done", short: "Practice Qs" },
  { id: "explain", label: "Explain or draw it from memory", short: "Explain" },
];

/**
 * Ready-made routines. The default is the one most people converge on; the
 * others exist because a lab week and an exam week genuinely aren't the same
 * job, and retyping six columns to say so is friction.
 */
export const TASK_PRESETS: { name: string; tasks: PlannerTask[] }[] = [
  { name: "Standard", tasks: DEFAULT_TASKS },
  {
    name: "Day before",
    tasks: [
      { id: "read", label: "Read the objectives", short: "Objectives" },
      { id: "preview", label: "Skim the slides", short: "Skim" },
      { id: "questions", label: "Note the questions to ask", short: "Questions" },
    ],
  },
  {
    name: "Weekend catch-up",
    tasks: [
      { id: "anki", label: "Clear the Anki backlog", short: "Anki" },
      { id: "close", label: "Close study the week's gaps", short: "Gaps" },
      { id: "questions", label: "Practice questions on the week", short: "Practice Qs" },
      { id: "explain", label: "Explain the week from memory", short: "Explain" },
      { id: "plan", label: "Plan the week ahead", short: "Plan" },
    ],
  },
  {
    name: "Exam run-up",
    tasks: [
      { id: "anki", label: "Anki reviewed to zero", short: "Anki" },
      { id: "questions", label: "Question bank block done", short: "Qbank" },
      { id: "weak", label: "Weak areas rewritten", short: "Weak areas" },
      { id: "explain", label: "Explained out loud", short: "Explain" },
    ],
  },
];

/**
 * A stable id for a new column. Ticks are stored against the id, so an id
 * must never collide with an existing one — renaming a column keeps its id
 * and therefore keeps its ticks.
 */
export function makeTaskId(label: string, existing: PlannerTask[]): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 20) || "task";
  const taken = new Set(existing.map((t) => t.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  }
}

/**
 * Words that mean an assessment wherever they appear.
 */
const DEFINITE_ASSESSMENT =
  /\b(quiz|midterms?|mid-terms?|assessments?|osce|shelf|nbme|finals|final exam|practical exam|written exam|oral exam|comprehensive exam|board exam|retakes?|make-?up exam|exam week)\b/;

/** "Exam" and "test" on their own, which are the ambiguous ones. */
const BARE_EXAM = /\b(exams?|examinations?|tests?)\b/;

/**
 * In medicine "exam" usually means examining a patient, not being examined.
 * A lecture called "Health History/Vitals/Exam" is a clinical skills class,
 * and calling it an assessment doesn't just mislabel one row — it makes the
 * planner claim an exam is coming and count every session before it as
 * revision for something that doesn't exist.
 */
const CLINICAL_CONTEXT =
  /\b(histor(y|ies)|vitals?|physical|patient|inspection|palpation|percussion|auscultation|interview|skills?|write ?-?up|presentation|basics of)\b/;

function isAssessment(lower: string): boolean {
  if (DEFINITE_ASSESSMENT.test(lower)) return true;
  return BARE_EXAM.test(lower) && !CLINICAL_CONTEXT.test(lower);
}

/**
 * What kind of session this is, from its title.
 *
 * Timetables label sessions consistently within a course but not between
 * them, so this reads the common prefixes ("Lab:", "SG:", "PP:") as well as
 * the words. Assessments are checked first and hardest — mistaking an exam
 * for a lecture is the one error with consequences.
 */
export function classifySession(summary: string): SessionKind {
  const s = summary.toLowerCase();

  // An unmistakable assessment word beats everything, including a prefix:
  // "Lab: Practical Exam" is an exam that happens to be held in the lab.
  if (DEFINITE_ASSESSMENT.test(s)) return "assessment";

  // Then the explicit label the timetable gives, which is more reliable than
  // any word in the title — "Lab: Thoracic Surface Examination" is a lab,
  // and the "examination" in it is something you do to a body.
  if (/^\s*lab\b|\blaboratory\b|\bdissection\b/.test(s)) return "lab";
  if (/^\s*sg\b|\bsmall group\b|\bcase discussion\b|\bpbl\b|\btbl\b/.test(s)) {
    return "smallGroup";
  }
  if (/^\s*pp\b|\bpatient present|\bclinical correlat/.test(s)) return "patient";
  if (/\bself[- ]?stud|\bconsolidat|\breview week\b|\bindependent\b/.test(s)) {
    return "selfStudy";
  }

  // Only now is a bare "exam" worth reading as one.
  if (isAssessment(s)) return "assessment";
  if (/\blecture\b|\bseminar\b/.test(s)) return "lecture";
  return "other";
}

/**
 * Strips what the title carries for the calendar's benefit rather than
 * yours: the session-type label, a leading date that the grid already shows
 * in its own column, and the opens/closes suffix a timed assessment gets.
 */
export function cleanTopic(summary: string): string {
  const cleaned = summary
    .replace(/^\s*\d{1,2}[./]\d{1,2}[./]\d{2,4}\s*[-–—:]?\s*/, "")
    .replace(/^\s*(lecture|lab|laboratory|sg|small group|pp|self[- ]?study)\s*[:–-]\s*/i, "")
    .replace(/\s*[-–—(]?\s*\b(opens?|closes?|due|window (?:opens?|closes?))\b\s*\)?\s*$/i, "")
    .trim();
  return cleaned || summary.trim();
}

/** Local midnight, so sessions group by the day they're actually on. */
function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday of the week containing `at`. */
export function startOfWeek(at: number): number {
  const d = new Date(startOfDay(at));
  // getDay() is 0 for Sunday; shift so weeks start on Monday.
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return d.getTime();
}

/**
 * Week 1 is the week the course starts, not the calendar year's first week —
 * which is how a syllabus numbers them and how people talk about them.
 */
export function weekNumber(at: number, firstSessionAt: number): number {
  const weeks = Math.round(
    (startOfWeek(at) - startOfWeek(firstSessionAt)) / (7 * 86400000)
  );
  return weeks + 1;
}

export function sessionsFromEvents(events: IcsEvent[]): PlannerSession[] {
  if (events.length === 0) return [];
  const first = events.reduce((min, e) => Math.min(min, e.start), Infinity);
  return mergeAssessmentWindows(
    events.map((e) => ({
      id: e.uid,
      week: weekNumber(e.start, first),
      kind: classifySession(`${e.summary} ${e.description ?? ""}`),
      topic: cleanTopic(e.summary),
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      location: e.location,
    }))
  );
}

/**
 * A timed quiz is published as two events — one when it opens, one when it
 * closes — which reads as two exams a week apart. They're one assessment,
 * and the one that matters is the deadline, so the pair collapses to the
 * later of the two.
 */
export function mergeAssessmentWindows(
  sessions: PlannerSession[]
): PlannerSession[] {
  const byTopic = new Map<string, PlannerSession>();
  const out: PlannerSession[] = [];
  for (const s of sessions) {
    if (s.kind !== "assessment") {
      out.push(s);
      continue;
    }
    const key = s.topic.toLowerCase();
    const seen = byTopic.get(key);
    if (!seen) {
      byTopic.set(key, s);
      out.push(s);
      continue;
    }
    // Same assessment twice: keep the later instant, which is the deadline.
    if (s.start > seen.start) {
      seen.start = s.start;
      seen.end = s.end;
      seen.week = s.week;
      seen.allDay = s.allDay;
    }
  }
  return out;
}

/**
 * Drops everything before a given day. Someone arriving mid-semester with a
 * full year imported doesn't want a wall of lectures they already sat
 * through, and the ticks are keyed by session id, so re-importing brings
 * both the sessions and their progress back.
 */
export function dropSessionsBefore(
  sessions: PlannerSession[],
  at: number
): PlannerSession[] {
  const cutoff = startOfDay(at);
  return sessions.filter((s) => s.start >= cutoff);
}

// ---------- progress ----------
// One flat map so a tick is a single small write rather than a rewrite of the
// whole semester. Firestore treats "." as a path separator, so ids that
// contain one would silently create nested fields.

export function progressKey(sessionId: string, taskId: string): string {
  return `${sessionId}__${taskId}`.replace(/\./g, "_");
}

export type PlannerProgress = Record<string, boolean>;

export function isDone(
  progress: PlannerProgress,
  sessionId: string,
  taskId: string
): boolean {
  return progress[progressKey(sessionId, taskId)] === true;
}

/** How much of a session's routine is finished, 0–1. */
export function sessionCompletion(
  progress: PlannerProgress,
  session: PlannerSession,
  tasks: PlannerTask[]
): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter((t) => isDone(progress, session.id, t.id)).length;
  return done / tasks.length;
}

// ---------- assessments ----------

export interface ExamOutlook {
  session: PlannerSession;
  /** whole days from now until it, negative once it's passed */
  daysAway: number;
  /** sessions it covers: everything since the previous assessment */
  covers: PlannerSession[];
  /** of those, the ones with unfinished routine */
  outstanding: PlannerSession[];
}

/**
 * What each assessment covers and how ready you are for it.
 *
 * "Covers" is taken to be everything taught since the previous assessment,
 * which is how a course actually blocks its material out, and means the
 * planner can say which specific sessions still need work rather than just
 * that an exam is coming.
 */
export function examOutlook(
  plan: Pick<PlannerPlan, "sessions" | "tasks">,
  progress: PlannerProgress,
  now = Date.now()
): ExamOutlook[] {
  const ordered = [...plan.sessions].sort((a, b) => a.start - b.start);
  const exams = ordered.filter((s) => s.kind === "assessment");
  const out: ExamOutlook[] = [];
  let previousExamAt = -Infinity;

  for (const exam of exams) {
    const covers = ordered.filter(
      (s) =>
        s.kind !== "assessment" &&
        s.start > previousExamAt &&
        s.start <= exam.start
    );
    const outstanding = covers.filter(
      (s) => sessionCompletion(progress, s, plan.tasks) < 1
    );
    out.push({
      session: exam,
      daysAway: Math.ceil((startOfDay(exam.start) - startOfDay(now)) / 86400000),
      covers,
      outstanding,
    });
    previousExamAt = exam.start;
  }
  return out;
}

/** Assessments close enough to be worth acting on, soonest first. */
export function upcomingExams(
  outlook: ExamOutlook[],
  leadDays: number
): ExamOutlook[] {
  return outlook
    .filter((e) => e.daysAway >= 0 && e.daysAway <= leadDays)
    .sort((a, b) => a.daysAway - b.daysAway);
}

/**
 * What to do today: the sessions on this date, plus the ones for tomorrow
 * worth previewing tonight — which is the shape of the routine people
 * actually follow.
 */
export function agendaFor(
  sessions: PlannerSession[],
  now = Date.now()
): { today: PlannerSession[]; tomorrow: PlannerSession[] } {
  const day = startOfDay(now);
  const next = day + 86400000;
  return {
    today: sessions
      .filter((s) => startOfDay(s.start) === day)
      .sort((a, b) => a.start - b.start),
    tomorrow: sessions
      .filter((s) => startOfDay(s.start) === next)
      .sort((a, b) => a.start - b.start),
  };
}
