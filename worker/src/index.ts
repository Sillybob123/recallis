// The reminder sender: a Cloudflare Worker on a cron trigger.
//
// Every quarter of an hour it wakes up, reads each account's reminder
// settings out of Firestore, asks the same pure functions the app uses which
// emails are due for that person right now, and posts them through the
// Cloudflare email binding. It holds no schedule of its own — change a time
// in the planner and the next run honours it.
//
// Three properties matter more than punctuality:
//
//   1. Nothing sends twice. Every email carries a dedupe key that's written
//      back only after the send succeeds, so a run that fires late, twice,
//      or overlapping still delivers each reminder once — and a failed send
//      is retried on the next tick rather than silently dropped.
//   2. One broken account can't stop the rest. Each is handled in its own
//      try/catch and failures are reported at the end of the run.
//   3. Nobody is starved. A Worker has a budget of subrequests per
//      invocation; when there are more accounts than one run can serve it
//      takes the next slice, remembering where it stopped. Because of (1) a
//      deferred account simply gets its email on the following tick.

import {
  dueEmails,
  pruneSent,
  type CustomReminder,
  type EmailJob,
  type EmailSettings,
} from "../../src/lib/emailReminders";
import { renderEmailHtml, renderEmailText } from "../../src/lib/emailTemplate";
import type { PlannerPlan, PlannerProgress } from "../../src/lib/planner";
import { connect, type Firestore } from "./firestore";

interface Env {
  /** service-account JSON; set with `wrangler secret put` */
  FIREBASE_SERVICE_ACCOUNT: string;
  /** the address reminders come from, e.g. reminders@recallis.org */
  MAIL_FROM: string;
  MAIL_FROM_NAME?: string;
  /** optional: set this secret to send through Resend instead of Cloudflare */
  RESEND_API_KEY?: string;
  EMAIL?: {
    send(message: {
      to: string | string[];
      from: { email: string; name?: string } | string;
      subject: string;
      html?: string;
      text?: string;
      headers?: Record<string, string>;
    }): Promise<unknown>;
  };
}

/**
 * A Worker gets a limited number of outbound requests per invocation. Each
 * account costs two reads plus a write, so this leaves comfortable headroom
 * under the free plan's fifty.
 */
const MAX_REQUESTS = 40;
const CURSOR_DOC = "plannerMeta/mailer";

// ---------- reading a user ----------

function settingsFrom(fields: Record<string, unknown>): EmailSettings {
  const f = fields as Partial<EmailSettings>;
  return {
    enabled: Boolean(f.enabled),
    email: typeof f.email === "string" ? f.email : "",
    timeZone: typeof f.timeZone === "string" ? f.timeZone : "UTC",
    onlyWhenBehind: f.onlyWhenBehind !== false,
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
  return {
    plan: planDoc ? (planDoc as unknown as PlannerPlan) : null,
    progress: (progressDoc?.done ?? {}) as PlannerProgress,
  };
}

// ---------- sending ----------

/**
 * Cloudflare sends the mail itself, which means no provider account and no
 * API key — but Email Sending has to be enabled on the account and the
 * domain onboarded first. Until that's done, setting a RESEND_API_KEY secret
 * switches to Resend instead, so the reminders aren't held up by a signup.
 */
async function send(env: Env, job: EmailJob, to: string): Promise<void> {
  const html = renderEmailHtml(job);
  const text = renderEmailText(job);
  // Every mailbox provider looks for this, and someone who wants out should
  // never have to hunt for the setting.
  const headers = { "List-Unsubscribe": "<https://recallis.org/planner>" };
  const name = env.MAIL_FROM_NAME || "Recallis";

  if (env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: `${name} <${env.MAIL_FROM}>`,
        to: [to],
        subject: job.subject,
        html,
        text,
        headers,
      }),
    });
    if (!res.ok) {
      // The reason (unverified domain, bad address) is in the body; the key
      // never is, so this is safe to put in the run log.
      throw new Error(`send failed (${res.status}): ${await res.text()}`);
    }
    return;
  }

  if (!env.EMAIL) {
    throw new Error(
      "No way to send: enable Cloudflare Email Sending for this domain, or set a RESEND_API_KEY secret."
    );
  }
  await env.EMAIL.send({
    to,
    from: { email: env.MAIL_FROM, name },
    subject: job.subject,
    html,
    text,
    headers,
  });
}

/** One example email, so someone can check it arrives before trusting it. */
function testJob(): EmailJob {
  return {
    kind: "custom",
    key: `test-${Date.now()}`,
    subject: "Your Recallis reminders are working",
    heading: "This is what a reminder looks like",
    intro:
      "You asked for a test. Real ones name the sessions you haven't finished and the exam they're leading up to.",
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

// ---------- the run ----------

export interface RunReport {
  accounts: number;
  served: number;
  sent: number;
  deferred: number;
  failures: string[];
}

/**
 * Picks up where the last run stopped when there were more accounts than a
 * single invocation can serve. Missing or corrupt state simply starts over,
 * which costs at most one duplicate pass and never a lost email.
 */
async function readCursor(db: Firestore): Promise<number> {
  const doc = await db.get(CURSOR_DOC).catch(() => null);
  const at = Number(doc?.at ?? 0);
  return Number.isFinite(at) && at >= 0 ? at : 0;
}

export async function run(env: Env, now = Date.now()): Promise<RunReport> {
  const db = await connect(env.FIREBASE_SERVICE_ACCOUNT);
  const users = await db.list("emailReminders");
  const report: RunReport = {
    accounts: users.length,
    served: 0,
    sent: 0,
    deferred: 0,
    failures: [],
  };

  if (users.length === 0) return report;

  // Only pay for the cursor when there are enough accounts to need one.
  const offset =
    users.length > MAX_REQUESTS / 3
      ? (await readCursor(db)) % users.length
      : 0;
  const ordered = [...users.slice(offset), ...users.slice(0, offset)];

  let index = 0;
  for (const doc of ordered) {
    if (db.requests >= MAX_REQUESTS) {
      report.deferred = ordered.length - index;
      break;
    }
    index++;
    const uid = doc.id;
    try {
      const settings = settingsFrom(doc.fields);
      if (!settings.enabled || !settings.email) continue;

      const { plan, progress } = await planFor(db, uid);
      const jobs = dueEmails(settings, plan, progress, now);
      if (settings.testRequested) jobs.unshift(testJob());
      if (jobs.length === 0) continue;

      report.served++;
      const nextSent = { ...settings.sent };
      for (const job of jobs) {
        await send(env, job, settings.email);
        nextSent[job.key] = now;
        report.sent++;
      }
      await db.patch(
        `emailReminders/${uid}`,
        { sent: pruneSent(nextSent, now) },
        // testRequested is in the mask but not the body, which deletes it.
        settings.testRequested ? ["sent", "testRequested"] : ["sent"]
      );
    } catch (err) {
      report.failures.push(`${uid}: ${(err as Error).message}`);
    }
  }

  if (report.deferred > 0) {
    await db
      .patch(CURSOR_DOC, { at: (offset + index) % users.length }, ["at"])
      .catch(() => {
        // Losing the cursor only means the next run starts from the top.
      });
  }
  return report;
}

export default {
  async scheduled(_event: unknown, env: Env): Promise<void> {
    if (!env.FIREBASE_SERVICE_ACCOUNT || !env.MAIL_FROM) {
      // Deployed but not configured: say what's missing rather than throwing
      // an error every quarter of an hour.
      console.log(
        "Reminders aren't configured yet — set the FIREBASE_SERVICE_ACCOUNT secret and the MAIL_FROM variable."
      );
      return;
    }
    const report = await run(env);
    console.log(
      `${report.accounts} accounts, ${report.served} with something due, ` +
        `${report.sent} emails sent` +
        (report.deferred ? `, ${report.deferred} deferred to the next run` : "")
    );
    for (const f of report.failures) console.error(f);
    if (report.failures.length) {
      // A red invocation in the dashboard is how you find out something
      // broke; the rest of the accounts have already been served.
      throw new Error(`${report.failures.length} account(s) failed`);
    }
  },

  // Nothing here serves traffic. Cron triggers are the entire job, and
  // exposing an HTTP path that sends email would be a way to be abused.
  async fetch(): Promise<Response> {
    return new Response(
      "This Worker only runs on a schedule. Reminders are configured in the Recallis planner.",
      { status: 404, headers: { "content-type": "text/plain" } }
    );
  },
};
