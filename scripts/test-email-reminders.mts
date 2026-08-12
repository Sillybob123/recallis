// Email is unforgiving: send one too many and someone unsubscribes, send it
// at the wrong hour and it wakes them up. So the two things tested hardest
// here are that a reminder never goes twice, and that "18:00" means 18:00
// where the user is, not where the sender happens to run.
import {
  DEFAULT_EMAIL_SETTINGS,
  addDays,
  daysBetween,
  describeSchedule,
  dueEmails,
  localDate,
  localMinutes,
  pruneSent,
  weekdayOf,
  type EmailSettings,
} from "../src/lib/emailReminders";
import { renderEmailHtml, renderEmailText } from "../src/lib/emailTemplate";
import { DEFAULT_TASKS, progressKey, type PlannerPlan } from "../src/lib/planner";
import {
  decodeFields,
  encodeFields,
  decodeValue,
  encodeValue,
} from "../worker/src/firestore";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---------- local time ----------
console.log("local time:");
{
  // 2026-08-12 22:30 UTC. Still the 12th in London, already the 13th in Tokyo.
  const at = Date.UTC(2026, 7, 12, 22, 30);
  check("UTC date", localDate(at, "UTC") === "2026-08-12", localDate(at, "UTC"));
  check(
    "a zone ahead has rolled over",
    localDate(at, "Asia/Tokyo") === "2026-08-13",
    localDate(at, "Asia/Tokyo")
  );
  check(
    "a zone behind has not",
    localDate(at, "America/New_York") === "2026-08-12",
    localDate(at, "America/New_York")
  );
  check("minutes past midnight", localMinutes(at, "UTC") === 22 * 60 + 30);
  check(
    "and in another zone",
    localMinutes(at, "Asia/Tokyo") === 7 * 60 + 30,
    String(localMinutes(at, "Asia/Tokyo"))
  );
  check(
    "midnight is 0, not 1440",
    localMinutes(Date.UTC(2026, 7, 12, 0, 0), "UTC") === 0
  );
  check("an unknown zone falls back rather than throwing",
    typeof localDate(at, "Not/AZone") === "string");
  check("2026-08-12 is a Wednesday", weekdayOf("2026-08-12") === 3);
  check("adding days crosses a month", addDays("2026-08-31", 1) === "2026-09-01");
  check("and going back crosses a year", addDays("2026-01-01", -1) === "2025-12-31");
  check("days between", daysBetween("2026-08-12", "2026-08-19") === 7);
  check("negative once passed", daysBetween("2026-08-19", "2026-08-12") === -7);
}

// ---------- a plan to reason about ----------
const TZ = "Europe/Budapest"; // UTC+2 in August
const day = (d: number, h: number) =>
  Date.UTC(2026, 7, d, h - 2, 0); // wall clock in TZ

const plan: PlannerPlan = {
  name: "Semester",
  tasks: DEFAULT_TASKS,
  examLeadDays: 7,
  updatedAt: 0,
  sessions: [
    { id: "s1", week: 1, kind: "lecture", topic: "Thoracic wall", start: day(12, 9), allDay: false },
    { id: "s2", week: 1, kind: "lab", topic: "Dissection", start: day(12, 14), allDay: false },
    { id: "s3", week: 1, kind: "lecture", topic: "Pleura", start: day(13, 9), allDay: false },
    { id: "x1", week: 2, kind: "assessment", topic: "Midterm", start: day(19, 9), allDay: false },
  ],
};

const settings = (over: Partial<EmailSettings> = {}): EmailSettings => ({
  ...DEFAULT_EMAIL_SETTINGS,
  enabled: true,
  email: "student@example.edu",
  timeZone: TZ,
  // Most cases below are about scheduling, so the all-clear email is left
  // on; the "only when behind" rule gets its own section.
  onlyWhenBehind: false,
  daily: { enabled: true, atMinutes: 18 * 60, days: [0, 1, 2, 3, 4, 5, 6] },
  weekly: { enabled: false, weekday: 0, atMinutes: 17 * 60 },
  exam: { enabled: false, leadDays: [7] },
  ...over,
});

// 12 August 2026, 18:30 local (16:30 UTC)
const evening = Date.UTC(2026, 7, 12, 16, 30);
const morning = Date.UTC(2026, 7, 12, 6, 0);

// ---------- the daily nudge ----------
console.log("\nthe daily email:");
{
  check("nothing before the chosen hour", dueEmails(settings(), plan, {}, morning).length === 0);

  const jobs = dueEmails(settings(), plan, {}, evening);
  check("one goes out in the evening", jobs.length === 1, `${jobs.length}`);
  const job = jobs[0];
  check("it's the daily one", job.kind === "daily");
  check(
    "it counts what's actually open",
    job.subject.startsWith("2 sessions still open"),
    job.subject
  );
  check(
    "today's unfinished sessions are listed",
    job.sections[0].lines.map((l) => l.title).join(",") === "Thoracic wall,Dissection",
    job.sections[0].lines.map((l) => l.title).join(",")
  );
  check(
    "tomorrow gets its own section",
    job.sections[1]?.lines[0]?.title === "Pleura"
  );
  check(
    "each line shows every step of the routine",
    job.sections[0].lines[0].steps?.length === DEFAULT_TASKS.length
  );

  check(
    "switched off means nothing",
    dueEmails(settings({ enabled: false }), plan, {}, evening).length === 0
  );
  check(
    "no address means nothing",
    dueEmails(settings({ email: "" }), plan, {}, evening).length === 0
  );
  check(
    "a day that isn't chosen is skipped",
    dueEmails(settings({ daily: { enabled: true, atMinutes: 0, days: [0] } }), plan, {}, evening)
      .length === 0,
    "the 12th is a Wednesday"
  );
}

// ---------- never twice ----------
console.log("\nnever sending twice:");
{
  const first = dueEmails(settings(), plan, {}, evening);
  const after = settings({ sent: { [first[0].key]: evening } });
  check("the same day is silent afterwards", dueEmails(after, plan, {}, evening).length === 0);
  check(
    "even hours later",
    dueEmails(after, plan, {}, evening + 4 * 3600000).length === 0
  );
  const nextDay = Date.UTC(2026, 7, 13, 16, 30);
  check("but tomorrow sends again", dueEmails(after, plan, {}, nextDay).length === 1);
  check(
    "and it's a different key",
    dueEmails(after, plan, {}, nextDay)[0].key !== first[0].key
  );
}

// ---------- finishing the work changes the email ----------
console.log("\nwhen the work is done:");
{
  const done: Record<string, boolean> = {};
  for (const s of ["s1", "s2"]) {
    for (const t of DEFAULT_TASKS) done[progressKey(s, t.id)] = true;
  }
  const jobs = dueEmails(settings(), plan, done, evening);
  check("it still writes, but differently", jobs.length === 1);
  check("and says so", jobs[0].heading === "You're on top of it", jobs[0].heading);
  check(
    "the tone is the good one",
    jobs[0].sections[0].tone === "good",
    jobs[0].sections[0].tone
  );
}
{
  // A day with nothing on it and nothing outstanding should not produce mail.
  const quiet = dueEmails(settings(), { ...plan, sessions: [] }, {}, evening);
  check("an empty day sends nothing at all", quiet.length === 0);
}

// ---------- only the steps you care about ----------
console.log("\nchasing only some steps:");
{
  const done: Record<string, boolean> = {};
  for (const s of ["s1", "s2"]) done[progressKey(s, "anki")] = true;
  const onlyAnki = settings({ taskIds: ["anki"] });
  const jobs = dueEmails(onlyAnki, plan, done, evening);
  check(
    "with Anki done and only Anki chased, today is clear",
    jobs[0].heading === "You're on top of it",
    jobs[0].heading
  );
  const all = dueEmails(settings(), plan, done, evening);
  check("while chasing everything, it isn't", all[0].heading === "2 things left");
}

// ---------- exams ----------
console.log("\nbefore an assessment:");
{
  const s = settings({
    daily: { enabled: false, atMinutes: 18 * 60, days: [] },
    exam: { enabled: true, leadDays: [7, 1] },
  });
  const sevenOut = dueEmails(s, plan, {}, evening); // 12th → exam on the 19th
  check("it writes seven days out", sevenOut.length === 1, `${sevenOut.length}`);
  check(
    "the subject leads with the countdown",
    sevenOut[0].subject.startsWith("Midterm is in 7 days"),
    sevenOut[0].subject
  );
  check(
    "and lists what's unfinished",
    sevenOut[0].sections[0].lines.length === 3,
    `${sevenOut[0].sections[0].lines.length}`
  );

  const sixOut = dueEmails(s, plan, {}, Date.UTC(2026, 7, 13, 16, 30));
  check("but not on a day that isn't in the list", sixOut.length === 0);

  const dayBefore = dueEmails(s, plan, {}, Date.UTC(2026, 7, 18, 16, 30));
  check("and again the day before", dayBefore.length === 1);
  check(
    "singular reads properly",
    dayBefore[0].heading === "1 day to Midterm",
    dayBefore[0].heading
  );

  const allDone: Record<string, boolean> = {};
  for (const id of ["s1", "s2", "s3"]) {
    for (const t of DEFAULT_TASKS) allDone[progressKey(id, t.id)] = true;
  }
  const ready = dueEmails(s, plan, allDone, evening);
  check(
    "when everything's finished it says you're ready",
    ready[0].sections[0].title === "You're ready",
    ready[0].sections[0].title
  );
}

// ---------- your own reminders ----------
console.log("\nreminders you set yourself:");
{
  const base = settings({ daily: { enabled: false, atMinutes: 0, days: [] } });
  const once = settings({
    ...base,
    custom: [
      {
        id: "r1",
        title: "Redraw the brachial plexus",
        date: "2026-08-12",
        atMinutes: 18 * 60,
        repeat: "once",
        enabled: true,
      },
    ],
  });
  check("it fires at the time you asked", dueEmails(once, plan, {}, evening).length === 1);
  check("not before it", dueEmails(once, plan, {}, morning).length === 0);
  check(
    "not before the date",
    dueEmails(
      { ...once, custom: [{ ...once.custom[0], date: "2026-08-20" }] },
      plan,
      {},
      evening
    ).length === 0
  );
  const sentOnce = { ...once, sent: { "custom-r1": evening } };
  check(
    "a one-off never comes back",
    dueEmails(sentOnce, plan, {}, Date.UTC(2026, 7, 20, 16, 30)).length === 0
  );
  check(
    "a switched-off one stays quiet",
    dueEmails(
      { ...once, custom: [{ ...once.custom[0], enabled: false }] },
      plan,
      {},
      evening
    ).length === 0
  );

  const daily = { ...once, custom: [{ ...once.custom[0], repeat: "daily" as const }] };
  const afterFirst = {
    ...daily,
    sent: { [dueEmails(daily, plan, {}, evening)[0].key]: evening },
  };
  check(
    "a daily one comes back tomorrow",
    dueEmails(afterFirst, plan, {}, Date.UTC(2026, 7, 13, 16, 30)).length === 1
  );
  check(
    "but not again today",
    dueEmails(afterFirst, plan, {}, evening + 3600000).length === 0
  );

  const weekly = { ...once, custom: [{ ...once.custom[0], repeat: "weekly" as const }] };
  check(
    "a weekly one waits for the same weekday",
    dueEmails(weekly, plan, {}, Date.UTC(2026, 7, 13, 16, 30)).length === 0
  );
  check(
    "and fires seven days later",
    dueEmails(weekly, plan, {}, Date.UTC(2026, 7, 19, 16, 30)).length === 1
  );

  const weekend = { ...once, custom: [{ ...once.custom[0], repeat: "weekdays" as const }] };
  check(
    "a weekdays one skips Saturday",
    dueEmails(weekend, plan, {}, Date.UTC(2026, 7, 15, 16, 30)).length === 0,
    "the 15th is a Saturday"
  );

  // Attached to a routine column, it lists what's still open under it.
  const attached = {
    ...once,
    custom: [{ ...once.custom[0], taskId: "anki", title: "Clear the Anki backlog" }],
  };
  const job = dueEmails(attached, plan, {}, evening)[0];
  check(
    "an attached column lists what's outstanding",
    job.sections[0].lines.length === 2,
    "only sessions that have already happened — you can't have made Anki for tomorrow's lecture"
  );
  const allAnki: Record<string, boolean> = {};
  for (const id of ["s1", "s2", "s3"]) allAnki[progressKey(id, "anki")] = true;
  check(
    "and says so when there's nothing left",
    dueEmails(attached, plan, allAnki, evening)[0].sections[0].tone === "good"
  );
}

// ---------- only when something is undone ----------
// The default, and the reason the emails stay worth opening: finish the day
// and nothing arrives.
console.log("\nonly when something isn't done:");
{
  const chase = settings({ onlyWhenBehind: true });
  check("with work outstanding it still writes", dueEmails(chase, plan, {}, evening).length === 1);

  const done: Record<string, boolean> = {};
  for (const id of ["s1", "s2"]) {
    for (const t of DEFAULT_TASKS) done[progressKey(id, t.id)] = true;
  }
  check(
    "with today finished, nothing goes out",
    dueEmails(chase, plan, done, evening).length === 0,
    "not even tomorrow's preview — that's the point of the setting"
  );
  check(
    "while with it switched off, the all-clear arrives",
    dueEmails(settings({ onlyWhenBehind: false }), plan, done, evening).length === 1
  );

  // The same rule applies to the exam email.
  const examOnly = settings({
    onlyWhenBehind: true,
    daily: { enabled: false, atMinutes: 18 * 60, days: [] },
    exam: { enabled: true, leadDays: [7] },
  });
  const allDone: Record<string, boolean> = {};
  for (const id of ["s1", "s2", "s3"]) {
    for (const t of DEFAULT_TASKS) allDone[progressKey(id, t.id)] = true;
  }
  check(
    "an exam you're ready for doesn't write either",
    dueEmails(examOnly, plan, allDone, evening).length === 0
  );
  check(
    "but one you aren't does",
    dueEmails(examOnly, plan, {}, evening).length === 1
  );
  check(
    "and it's mentioned in the description",
    describeSchedule(chase)[0].includes("only when something is unfinished")
  );
}

// ---------- the weekly plan ----------
console.log("\nthe week ahead:");
{
  const s = settings({
    daily: { enabled: false, atMinutes: 0, days: [] },
    weekly: { enabled: true, weekday: 0, atMinutes: 17 * 60 },
  });
  const sunday = Date.UTC(2026, 7, 9, 16, 0); // 9 Aug 2026 is a Sunday, 18:00 local
  const jobs = dueEmails(s, plan, {}, sunday);
  check("it goes out on the chosen weekday", jobs.length === 1, `${jobs.length}`);
  check(
    "and covers the coming seven days",
    jobs[0].sections[0].lines.length === 3,
    "the three sessions in that window; the exam ten days out isn't in it yet"
  );
  check(
    "not on other days",
    dueEmails(s, plan, {}, Date.UTC(2026, 7, 10, 16, 0)).length === 0
  );
}

// ---------- housekeeping ----------
console.log("\nhousekeeping:");
{
  const now = Date.UTC(2026, 7, 12);
  const pruned = pruneSent(
    { recent: now - 86400000, ancient: now - 200 * 86400000 },
    now
  );
  check("old keys are dropped", !("ancient" in pruned) && "recent" in pruned);

  const lines = describeSchedule(settings({ exam: { enabled: true, leadDays: [7, 1] } }));
  check("the schedule describes itself", lines.length >= 2, lines.join(" | "));
  check(
    "weekday shorthand is recognised",
    describeSchedule(
      settings({ daily: { enabled: true, atMinutes: 540, days: [1, 2, 3, 4, 5] } })
    )[0].includes("on weekdays")
  );
  check(
    "and switched off says so",
    describeSchedule({ ...settings(), enabled: false })[0] === "No emails are being sent."
  );
}

// ---------- the email itself ----------
console.log("\nrendering:");
{
  const job = dueEmails(settings(), plan, {}, evening)[0];
  const html = renderEmailHtml(job);
  check("it's a whole document", html.startsWith("<!doctype html>"));
  check("the subject is in the title", html.includes(job.subject));
  check("sessions appear", html.includes("Thoracic wall"));
  check("there's one call to action", html.split("recallis.org/planner").length - 1 === 1);
  check("no remote images to be blocked", !/<img/i.test(html));
  check("no external stylesheet or script", !/<link|<script/i.test(html));
  check(
    "layout is tables, which is the only thing email clients agree on",
    html.includes('role="presentation"')
  );

  const nasty = {
    ...job,
    heading: '<script>alert("x")</script>',
    sections: [{ title: "T & T", lines: [{ title: "a < b" }] }],
  };
  const escaped = renderEmailHtml(nasty);
  check("markup in your own text is escaped", !escaped.includes("<script>alert"));
  check("ampersands survive as entities", escaped.includes("T &amp; T"));

  const text = renderEmailText(job);
  check("there's a plain-text part", text.includes("Thoracic wall"));
  check("which names what's still to do", text.includes("still to do:"));
  check("and carries the link", text.includes("https://recallis.org/planner"));
}

// ---------- the sender's wire format ----------
console.log("\nfirestore encoding:");
{
  check("integers come back as numbers", decodeValue({ integerValue: "1786492288973" }) === 1786492288973);
  check("booleans survive", decodeValue({ booleanValue: true }) === true);
  check("null is null", decodeValue({ nullValue: null }) === null);
  const round = decodeFields(
    encodeFields({
      enabled: true,
      email: "a@b.co",
      daily: { atMinutes: 1080, days: [1, 2, 3] },
      sent: { "daily-2026-08-12": 1786492288973 },
      ratio: 0.5,
    })
  );
  check("a nested map round-trips", JSON.stringify(round.daily) === JSON.stringify({ atMinutes: 1080, days: [1, 2, 3] }), JSON.stringify(round.daily));
  check("so does the sent map", (round.sent as Record<string, number>)["daily-2026-08-12"] === 1786492288973);
  check("and a fraction stays a fraction", round.ratio === 0.5);
  check(
    "undefined fields are dropped rather than written as null",
    !("missing" in encodeFields({ missing: undefined, kept: 1 }))
  );
  check("an integer is tagged as one", "integerValue" in encodeValue(5));
  check("a fraction is not", "doubleValue" in encodeValue(5.5));
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
