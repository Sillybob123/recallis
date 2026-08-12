// The scheduled sender.
//
// Runs on a cron (see .github/workflows/reminders.yml), asks the same pure
// functions the app uses which emails are due, and posts them. It holds no
// schedule of its own: everything it knows comes from each user's settings
// document, so changing a time in the app changes the next send.
//
// Two properties matter more than punctuality, because a cron job is never
// punctual:
//
//   1. Nothing sends twice. Every email carries a dedupe key that's written
//      back after a successful send, so a run that fires late, twice, or
//      overlaps another still delivers each reminder once.
//   2. One broken account can't stop the rest. Each user is handled in its
//      own try/catch and failures are reported at the end.
//
// Environment:
//   FIREBASE_SERVICE_ACCOUNT  service-account JSON (a secret)
//   RESEND_API_KEY            mail provider key (a secret)
//   MAIL_FROM                 e.g. "Recallis <reminders@recallis.org>"
//   DRY_RUN=1                 decide and print, send nothing

import {
  dueEmails,
  pruneSent,
  type CustomReminder,
  type EmailJob,
  type EmailSettings,
} from "../src/lib/emailReminders";
import { renderEmailHtml, renderEmailText } from "../src/lib/emailTemplate";
import type { PlannerPlan, PlannerProgress } from "../src/lib/planner";
import { connect, type Firestore } from "./firestoreRest.mts";

const DRY_RUN = process.env.DRY_RUN === "1";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set.`);
  return v;
}

// ---------- sending ----------

async function sendEmail(job: EmailJob, to: string): Promise<void> {
  const from = need("MAIL_FROM");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${need("RESEND_API_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: job.subject,
      html: renderEmailHtml(job),
      text: renderEmailText(job),
    }),
  });
  if (!res.ok) {
    // The body carries the reason (unverified domain, bad address); the key
    // is never in it, so this is safe to surface in the run log.
    throw new Error(`send failed (${res.status}): ${await res.text()}`);
  }
}

/** One example email, so someone can check it arrives before trusting it. */
function testJob(): EmailJob {
  return {
    kind: "custom",
    key: `test-${Date.now()}`,
    subject: "Your Recallis reminders are working",
    heading: "This is what a reminder looks like",
    intro:
      "You asked for a test. Real ones will name the sessions you haven't finished and the exam they're leading up to.",
    sections: [
      {
        title: "An example day",
        lines: [
          {
            title: "Thoracic wall and pleura",
            meta: "Monday 8 September · 09:00 · Hall A",
            steps: [
              { label: "Preview", done: true },
              { label: "View", done: true },
              { label: "Close study", done: false },
              { label: "Anki", done: false },
            ],
          },
        ],
      },
    ],
  };
}

// ---------- reading a user ----------

function settingsFrom(fields: Record<string, unknown>): EmailSettings {
  const f = fields as Partial<EmailSettings>;
  return {
    enabled: Boolean(f.enabled),
    email: typeof f.email === "string" ? f.email : "",
    timeZone: typeof f.timeZone === "string" ? f.timeZone : "UTC",
    daily: {
      enabled: Boolean(f.daily?.enabled),
      atMinutes: Number(f.daily?.atMinutes ?? 18 * 60),
      days: (f.daily?.days ?? []).map(Number),
    },
    weekly: {
      enabled: Boolean(f.weekly?.enabled),
      weekday: Number(f.weekly?.weekday ?? 0),
      atMinutes: Number(f.weekly?.atMinutes ?? 17 * 60),
    },
    exam: {
      enabled: Boolean(f.exam?.enabled),
      leadDays: (f.exam?.leadDays ?? []).map(Number),
    },
    taskIds: (f.taskIds ?? []).map(String),
    custom: (f.custom ?? []).map((r: CustomReminder) => ({
      ...r,
      atMinutes: Number(r.atMinutes ?? 0),
      enabled: Boolean(r.enabled),
    })),
    sent: (f.sent ?? {}) as Record<string, number>,
    testRequested: f.testRequested ? Number(f.testRequested) : undefined,
    updatedAt: Number(f.updatedAt ?? 0),
  };
}

async function planFor(
  db: Firestore,
  uid: string
): Promise<{ plan: PlannerPlan | null; progress: PlannerProgress }> {
  const [planDoc, progressDoc] = await Promise.all([
    db.get(`users/${uid}/planner/plan`).catch(() => null),
    db.get(`users/${uid}/planner/progress`).catch(() => null),
  ]);
  const plan = planDoc ? (planDoc as unknown as PlannerPlan) : null;
  const progress = (progressDoc?.done ?? {}) as PlannerProgress;
  return { plan, progress };
}

// ---------- the run ----------

/**
 * Until the secrets are added the schedule still fires, and a job that fails
 * every half hour emails its owner about it every half hour. So an
 * unconfigured sender says what's missing and finishes green.
 */
function configured(): boolean {
  const missing = ["FIREBASE_SERVICE_ACCOUNT", "RESEND_API_KEY", "MAIL_FROM"].filter(
    (name) => !process.env[name]
  );
  if (missing.length === 0) return true;
  console.log(
    `Email reminders aren't set up yet — missing ${missing.join(", ")}.\n` +
      "Add them under Settings → Secrets and variables → Actions " +
      "(see the comment at the top of .github/workflows/reminders.yml).\n" +
      "Nothing was sent, and nothing is wrong."
  );
  return false;
}

async function main() {
  if (!configured()) return;
  const db = await connect(need("FIREBASE_SERVICE_ACCOUNT"));
  const now = Date.now();
  const users = await db.list("emailReminders");
  console.log(`${users.length} accounts with a reminder document.`);

  let sent = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const doc of users) {
    const uid = doc.id;
    try {
      const settings = settingsFrom(doc.fields);
      if (!settings.enabled || !settings.email) {
        skipped++;
        continue;
      }
      const { plan, progress } = await planFor(db, uid);
      const jobs = dueEmails(settings, plan, progress, now);
      if (settings.testRequested) jobs.unshift(testJob());
      if (jobs.length === 0) {
        skipped++;
        continue;
      }

      const nextSent = { ...settings.sent };
      for (const job of jobs) {
        if (DRY_RUN) {
          console.log(`  [dry] ${uid.slice(0, 6)}… ${job.kind}: ${job.subject}`);
        } else {
          await sendEmail(job, settings.email);
          console.log(`  sent ${job.kind} to ${uid.slice(0, 6)}…`);
        }
        // Recorded only after the send succeeds, so a provider outage means
        // a retry next run rather than a silently dropped reminder.
        nextSent[job.key] = now;
        sent++;
      }

      if (!DRY_RUN) {
        await db.patch(
          `emailReminders/${uid}`,
          { sent: pruneSent(nextSent, now) },
          // testRequested is in the mask but not the body, which deletes it.
          settings.testRequested ? ["sent", "testRequested"] : ["sent"]
        );
      }
    } catch (err) {
      failures.push(`${uid}: ${(err as Error).message}`);
    }
  }

  console.log(
    `\n${sent} email${sent === 1 ? "" : "s"} ${DRY_RUN ? "would be sent" : "sent"}, ` +
      `${skipped} account${skipped === 1 ? "" : "s"} had nothing due.`
  );
  if (failures.length) {
    console.error(`\n${failures.length} account(s) failed:`);
    for (const f of failures) console.error(`  ${f}`);
    // A failing account is worth a red run, but only after everyone else
    // has been served.
    process.exit(1);
  }
}

// A missing secret is the most likely failure, and a stack trace buries the
// one line that says which one.
try {
  await main();
} catch (err) {
  console.error(`\nThe run stopped: ${(err as Error).message}`);
  process.exit(1);
}
