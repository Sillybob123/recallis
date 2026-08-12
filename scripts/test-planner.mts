// The planner is only useful if it reads a real timetable correctly and, above
// all, never mistakes an exam for an ordinary lecture.
import { parseIcs, parseIcsDate } from "../src/lib/ics";
import {
  classifySession,
  cleanTopic,
  sessionsFromEvents,
  weekNumber,
  startOfWeek,
  progressKey,
  sessionCompletion,
  examOutlook,
  upcomingExams,
  agendaFor,
  DEFAULT_TASKS,
  type PlannerProgress,
  type PlannerSession,
} from "../src/lib/planner";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---------- reading the file ----------
console.log("parsing a timetable:");
const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:1@school",
  "DTSTART:20260810T090000",
  "DTEND:20260810T100000",
  "SUMMARY:Anatomic Nomenclature",
  "LOCATION:Hall A",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:2@school",
  "DTSTART:20260810T130000",
  "SUMMARY:Lab: Thoracic Surface Examination",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:3@school",
  "DTSTART:20260811T090000",
  "SUMMARY:SG: Radiology of the thorax and neck",
  "DESCRIPTION:Bring the reading\\, and a pen",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:4@school",
  "DTSTART;VALUE=DATE:20260828",
  "SUMMARY:ASSESSMENT ONE",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

{
  const { events, warnings } = parseIcs(ICS);
  check("every event is read", events.length === 4, `${events.length}`);
  check("they come back in time order", events[0].summary === "Anatomic Nomenclature");
  check("location survives", events[0].location === "Hall A");
  check(
    "escaped commas are unescaped",
    events[2].description === "Bring the reading, and a pen",
    events[2].description
  );
  check("an all-day event is marked as one", events[3].allDay === true);
  check("nothing to warn about here", warnings.length === 0);
}
{
  // Long summaries are folded across lines in real files.
  const folded = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:f@x",
    "DTSTART:20260810T090000",
    "SUMMARY:Molecular mechanisms of non-Mendelian inheritance",
    "  in humans: mosaicism",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const { events } = parseIcs(folded);
  check(
    "a folded line is rejoined",
    events[0]?.summary === "Molecular mechanisms of non-Mendelian inheritance in humans: mosaicism",
    events[0]?.summary
  );
}
{
  // An alarm inside an event carries its own trigger; it must not be read
  // as the event's time.
  const withAlarm = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:a@x",
    "DTSTART:20260810T090000",
    "SUMMARY:Enzymes",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "DTSTART:20260101T000000",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const { events } = parseIcs(withAlarm);
  check(
    "a nested alarm doesn't move the event",
    events.length === 1 &&
      new Date(events[0].start).getFullYear() === 2026 &&
      new Date(events[0].start).getMonth() === 7,
    new Date(events[0]?.start ?? 0).toISOString()
  );
}
{
  const weekly = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:r@x",
    "DTSTART:20260810T090000",
    "SUMMARY:Self-study",
    "RRULE:FREQ=WEEKLY;COUNT=4",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const { events } = parseIcs(weekly);
  check("a weekly repeat expands", events.length === 4, `${events.length}`);
  check(
    "each occurrence is a week apart",
    events[1].start - events[0].start === 7 * 86400000
  );
  check("and each gets its own id", new Set(events.map((e) => e.uid)).size === 4);
}
{
  const monthly = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:m@x",
    "DTSTART:20260810T090000",
    "SUMMARY:Portfolio review",
    "RRULE:FREQ=MONTHLY;COUNT=6",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const { events, warnings } = parseIcs(monthly);
  check(
    "a repeat it can't expand is kept once and reported",
    events.length === 1 && warnings.length === 1,
    warnings[0]
  );
}
{
  check("UTC times are read as UTC",
    parseIcsDate("20260810T140000Z")?.at === Date.UTC(2026, 7, 10, 14, 0, 0));
  check("a date with no time is all-day", parseIcsDate("20260810")?.allDay === true);
  check("nonsense returns nothing", parseIcsDate("not-a-date") === null);
  check("an empty file is safe", parseIcs("").events.length === 0);
  check("a truncated file is safe", parseIcs("BEGIN:VCALENDAR\nBEGIN:VEVENT").events.length === 0);
}

// ---------- classifying ----------
console.log("\nwhat kind of session:");
for (const [title, kind] of [
  ["Anatomic Nomenclature", "other"],
  ["Lecture: Enzymes", "lecture"],
  ["Lab: Thoracic Surface Examination", "lab"],
  ["SG: Radiology of the thorax", "smallGroup"],
  ["PP: Cystic Fibrosis", "patient"],
  ["Self-study: consolidate week 1", "selfStudy"],
  ["ASSESSMENT ONE", "assessment"],
  ["Midterm Exam", "assessment"],
  ["Quiz 3", "assessment"],
  ["Anatomy Practical Exam", "assessment"],
  ["NBME shelf", "assessment"],
] as const) {
  check(`"${title}" → ${classifySession(title)}`, classifySession(title) === kind);
}
check(
  "an exam in a lab slot is still an exam",
  classifySession("Lab: Practical Exam") === "assessment",
  "getting this wrong is the one that costs you"
);
check(
  "the label is stripped from the topic",
  cleanTopic("Lab: Thoracic Surface Examination") === "Thoracic Surface Examination"
);
check(
  "a title with no label is left alone",
  cleanTopic("Anatomic Nomenclature") === "Anatomic Nomenclature"
);

// ---------- the ones the real timetable got wrong ----------
// Every case here is a row that was mislabelled or unreadable on a real
// imported calendar.
console.log("\nreal timetable rows:");
{
  const { decodeEntities } = await import("../src/lib/ics");
  const { mergeWindows, windowRole, dueAt, repairSessions, dropSessionsBefore } =
    await import("../src/lib/planner");

  check(
    "an escaped ampersand is decoded",
    decodeEntities("Write Up/Presentation &amp; Vitals") ===
      "Write Up/Presentation & Vitals"
  );
  check("and a numeric entity", decodeEntities("Caf&#233;") === "Café");
  check("text without entities is untouched", decodeEntities("Thorax") === "Thorax");
  check(
    "a double-escaped tag doesn't become one",
    decodeEntities("&amp;lt;b&amp;gt;") === "&lt;b&gt;"
  );

  check(
    "a clinical skills class is not an exam",
    classifySession("Introduction/Health History/Vitals/Exam") !== "assessment",
    "\"exam\" here means examining a patient"
  );
  check(
    "nor is the write-up that goes with it",
    classifySession("Write Up/Presentation & Vitals/Basics of Exam") !== "assessment"
  );
  check(
    "while a quiz still is",
    classifySession("08.19.26 Quiz - Radiology of the Thorax and Neck opens") ===
      "assessment"
  );
  check(
    "and a practical exam still is",
    classifySession("Anatomy Practical Exam") === "assessment",
    "the guard must not swallow the real ones"
  );
  check("a bare exam with no clinical context still counts",
    classifySession("Exam 2") === "assessment");

  check(
    "a leading date is stripped from the topic",
    cleanTopic("08.19.26 Quiz - Radiology of the Thorax and Neck") ===
      "Quiz - Radiology of the Thorax and Neck",
    cleanTopic("08.19.26 Quiz - Radiology of the Thorax and Neck")
  );
  check(
    "so is the opens/closes suffix",
    cleanTopic("08.19.26 Quiz - Radiology of the Thorax and Neck closes") ===
      "Quiz - Radiology of the Thorax and Neck"
  );

  check("a title ending in \"opens\" is the start of a window", windowRole("Quiz opens") === "opens");
  check("and \"closes\" the end", windowRole("Quiz closes") === "closes");
  check("\"due\" counts as the end too", windowRole("Essay due") === "closes");
  check("an ordinary title has no role", windowRole("Thorax") === null);

  // Opens and closes are one assignment with a window to do it in.
  const opens = new Date(2026, 7, 13, 11, 30).getTime();
  const closes = new Date(2026, 7, 13, 12, 31).getTime();
  const merged = mergeWindows([
    { role: "opens", session: { id: "a", week: 1, kind: "other", topic: "Pearls: Mediastinum", start: opens, allDay: false } },
    { role: "closes", session: { id: "b", week: 1, kind: "other", topic: "Pearls: Mediastinum", start: closes, allDay: false } },
  ]);
  check("the pair becomes one row", merged.length === 1);
  check("starting when it opens", merged[0].start === opens);
  check("ending when it closes", merged[0].end === closes, "that's the deadline");
  check("and it knows it's a window", merged[0].window === true);
  check("so the due time is the close", dueAt(merged[0]) === closes);
  check(
    "while an ordinary session is due when it starts",
    dueAt({ id: "x", week: 1, kind: "lecture", topic: "T", start: opens, allDay: false }) === opens
  );

  const twoDifferent = mergeWindows([
    { role: null, session: { id: "a", week: 1, kind: "lecture", topic: "Anatomy", start: opens, allDay: false } },
    { role: null, session: { id: "b", week: 1, kind: "lecture", topic: "Anatomy", start: closes, allDay: false } },
  ]);
  check(
    "two real sessions with the same name both survive",
    twoDifferent.length === 2,
    "a repeated lecture is not a window"
  );

  // Repairing a plan stored by the older version, without a re-import.
  const stored: PlannerSession[] = [
    { id: "1", week: 1, kind: "assessment", topic: "Introduction/Health History/Vitals/Exam", start: opens, allDay: false },
    { id: "2", week: 1, kind: "lab", topic: "Thoracic Surface Examination", start: opens, allDay: false },
    { id: "3", week: 1, kind: "other", topic: "08.13.26 Pearls: Superior &amp; Middle Mediastinum opens", start: opens, allDay: false },
    { id: "4", week: 1, kind: "other", topic: "08.13.26 Pearls: Superior &amp; Middle Mediastinum closes", start: closes, allDay: false },
    { id: "5", week: 1, kind: "lecture", topic: "Vitals/Exam", start: opens, allDay: false, edited: true },
  ];
  const fixed = repairSessions(stored, decodeEntities);
  check(
    "the clinical skills class stops being an exam",
    fixed.find((f) => f.id === "1")?.kind !== "assessment"
  );
  check(
    "the lab stays a lab",
    fixed.find((f) => f.id === "2")?.kind === "lab",
    "relaxing only, never tightening"
  );
  check(
    "the entity and date are cleaned up",
    fixed.find((f) => f.id === "3")?.topic === "Pearls: Superior & Middle Mediastinum",
    fixed.find((f) => f.id === "3")?.topic
  );
  check("and the pair is merged", fixed.filter((f) => f.topic.includes("Pearls")).length === 1);
  check("with the closing time kept", fixed.find((f) => f.id === "3")?.end === closes);
  check(
    "a session you corrected by hand is untouched",
    fixed.find((f) => f.id === "5")?.topic === "Vitals/Exam"
  );

  // Starting fresh mid-semester.
  const past = { id: "p", week: 1, kind: "lecture" as const, topic: "Old", start: new Date(2026, 7, 1).getTime(), allDay: false };
  const today = { id: "t", week: 3, kind: "lecture" as const, topic: "Today", start: new Date(2026, 7, 12, 9).getTime(), allDay: false };
  const later = { id: "l", week: 4, kind: "lecture" as const, topic: "Later", start: new Date(2026, 7, 20).getTime(), allDay: false };
  const kept = dropSessionsBefore([past, today, later], new Date(2026, 7, 12, 15).getTime());
  check(
    "clearing the past keeps today",
    kept.map((k) => k.id).join() === "t,l",
    "cutting at midnight, not at the current moment"
  );
}

// ---------- weeks ----------
console.log("\nweeks:");
{
  const monday = new Date(2026, 7, 10).getTime(); // a Monday
  const friday = new Date(2026, 7, 14).getTime();
  const nextMonday = new Date(2026, 7, 17).getTime();
  check("week 1 is the week the course starts", weekNumber(monday, monday) === 1);
  check("later the same week is still week 1", weekNumber(friday, monday) === 1);
  check("the following Monday is week 2", weekNumber(nextMonday, monday) === 2);
  const sunday = new Date(2026, 7, 16).getTime();
  check(
    "Sunday belongs to the week that just ended, not the next",
    weekNumber(sunday, monday) === 1,
    "weeks run Monday to Sunday"
  );
  check("weeks start on Monday", new Date(startOfWeek(friday)).getDay() === 1);
}

// ---------- progress ----------
console.log("\nticking things off:");
{
  const { events } = parseIcs(ICS);
  const sessions = sessionsFromEvents(events);
  check("sessions carry their week", sessions[0].week === 1);
  check(
    "the assessment three weeks later is week 3",
    sessions.find((s) => s.kind === "assessment")?.week === 3,
    `${sessions.find((s) => s.kind === "assessment")?.week}`
  );

  const progress: PlannerProgress = {};
  const s = sessions[0];
  check("nothing done to start", sessionCompletion(progress, s, DEFAULT_TASKS) === 0);
  progress[progressKey(s.id, "preview")] = true;
  progress[progressKey(s.id, "attend")] = true;
  check(
    "two of six is a third",
    Math.abs(sessionCompletion(progress, s, DEFAULT_TASKS) - 2 / 6) < 1e-9
  );
  for (const t of DEFAULT_TASKS) progress[progressKey(s.id, t.id)] = true;
  check("all six is finished", sessionCompletion(progress, s, DEFAULT_TASKS) === 1);
  check(
    "ids with dots can't create nested fields",
    !progressKey("a.b@school", "anki").includes("."),
    progressKey("a.b@school", "anki")
  );
}

// ---------- assessments ----------
console.log("\nassessments:");
{
  const { events } = parseIcs(ICS);
  const sessions = sessionsFromEvents(events);
  const plan = { sessions, tasks: DEFAULT_TASKS };
  const progress: PlannerProgress = {};
  const outlook = examOutlook(plan, progress, new Date(2026, 7, 21).getTime());
  check("the assessment is found", outlook.length === 1);
  check(
    "it covers everything taught before it",
    outlook[0].covers.length === 3,
    `${outlook[0].covers.length} sessions`
  );
  check(
    "and all of them are outstanding when nothing is ticked",
    outlook[0].outstanding.length === 3
  );
  check("it is a week away", outlook[0].daysAway === 7, `${outlook[0].daysAway}`);
  check(
    "so it shows up with a week's notice",
    upcomingExams(outlook, 7).length === 1
  );
  check(
    "but not with three days' notice",
    upcomingExams(outlook, 3).length === 0
  );

  // Finish one session and it drops off the outstanding list.
  for (const t of DEFAULT_TASKS) progress[progressKey(sessions[0].id, t.id)] = true;
  const after = examOutlook(plan, progress, new Date(2026, 7, 21).getTime());
  check(
    "finishing a session removes it from the list",
    after[0].outstanding.length === 2,
    "so the exam view shows what's actually left"
  );
  const past = examOutlook(plan, progress, new Date(2026, 8, 10).getTime());
  check("a passed assessment reads as negative days", past[0].daysAway < 0);
  check("and is not offered as upcoming", upcomingExams(past, 7).length === 0);
}
{
  // Two assessments: the second covers only what came after the first.
  const sessions = sessionsFromEvents(
    parseIcs(
      [
        "BEGIN:VCALENDAR",
        ...[
          ["a", "20260810T090000", "Lecture one"],
          ["b", "20260811T090000", "Midterm Exam"],
          ["c", "20260812T090000", "Lecture two"],
          ["d", "20260813T090000", "Final Exam"],
        ].flatMap(([uid, dt, sum]) => [
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `DTSTART:${dt}`,
          `SUMMARY:${sum}`,
          "END:VEVENT",
        ]),
        "END:VCALENDAR",
      ].join("\r\n")
    ).events
  );
  const outlook = examOutlook({ sessions, tasks: DEFAULT_TASKS }, {});
  check("both assessments are found", outlook.length === 2);
  check("the first covers what came before it", outlook[0].covers.length === 1);
  check(
    "the second covers only what came after the first",
    outlook[1].covers.length === 1 && outlook[1].covers[0].topic === "Lecture two",
    outlook[1].covers.map((c) => c.topic).join(", ")
  );
}

// ---------- today ----------
console.log("\nwhat's on:");
{
  const { events } = parseIcs(ICS);
  const sessions = sessionsFromEvents(events);
  const { today, tomorrow } = agendaFor(sessions, new Date(2026, 7, 10, 12).getTime());
  check("today's sessions are listed", today.length === 2, `${today.length}`);
  check("in time order", today[0].start < today[1].start);
  check("and tomorrow's are separate", tomorrow.length === 1);
  const quiet = agendaFor(sessions, new Date(2026, 11, 25).getTime());
  check("a day with nothing on is empty, not broken",
    quiet.today.length === 0 && quiet.tomorrow.length === 0);
}

// ---------- editing the routine ----------
// Ticks are stored against a column's id, so ids have to stay unique and
// renaming must not mint a new one.
console.log("\nediting the routine:");
{
  const { makeTaskId, TASK_PRESETS } = await import("../src/lib/planner");
  check("a new column gets a slug", makeTaskId("Practice Qs", []) === "practiceqs");
  check(
    "a clash is numbered rather than reused",
    makeTaskId("Anki", DEFAULT_TASKS) === "anki2"
  );
  check("nonsense still yields an id", makeTaskId("???", []) === "task");
  for (const preset of TASK_PRESETS) {
    check(
      `"${preset.name}" has unique columns`,
      new Set(preset.tasks.map((t) => t.id)).size === preset.tasks.length
    );
  }
}

// ---------- reminders ----------
// A web page can only notify while it is open, so the rule is "the first time
// you're here on or after your chosen time, once a day".
console.log("\nreminders:");
{
  const { reminderDue, markReminded, DEFAULT_REMINDERS } = await import(
    "../src/lib/reminders"
  );
  const at6pm = { ...DEFAULT_REMINDERS, enabled: true, atMinutes: 18 * 60 };
  const morning = new Date(2026, 7, 10, 9, 0).getTime();
  const evening = new Date(2026, 7, 10, 18, 30).getTime();

  check("nothing before the chosen time", !reminderDue(at6pm, morning, "granted"));
  check("due once past it", reminderDue(at6pm, evening, "granted"));
  check(
    "never without permission",
    !reminderDue(at6pm, evening, "default") &&
      !reminderDue(at6pm, evening, "denied")
  );
  check(
    "never when switched off",
    !reminderDue({ ...at6pm, enabled: false }, evening, "granted")
  );

  const after = markReminded(at6pm, evening);
  check("not again the same day", !reminderDue(after, evening + 3600000, "granted"));
  const nextDay = new Date(2026, 7, 11, 18, 30).getTime();
  check("but again tomorrow", reminderDue(after, nextDay, "granted"));
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
