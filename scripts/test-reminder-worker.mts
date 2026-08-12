// The Worker end of the reminders: does a run actually read Firestore, send
// the right people the right mail, and — the part that would be embarrassing
// to get wrong — never send the same reminder twice?
//
// Firestore and the email binding are stubbed, but the JWT is signed with a
// real generated RSA key through the same WebCrypto path the Worker uses, so
// the auth code is exercised rather than mocked away.
import { run } from "../worker/src/index";
import { encodeFields } from "../worker/src/firestore";
import { DEFAULT_TASKS, progressKey } from "../src/lib/planner";
import { DEFAULT_EMAIL_SETTINGS, type EmailSettings } from "../src/lib/emailReminders";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---------- a service account with a real key ----------

async function makeServiceAccount(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  const der = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const b64 = Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n");
  return JSON.stringify({
    client_email: "reminders@med-quizlet.iam.gserviceaccount.com",
    project_id: "med-quizlet",
    private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
  });
}

// ---------- a fake Firestore ----------

const TZ = "Europe/Budapest";
const day = (d: number, h: number) => Date.UTC(2026, 7, d, h - 2, 0);
const evening = Date.UTC(2026, 7, 12, 16, 30); // 18:30 local

const planDoc = {
  name: "Semester",
  tasks: DEFAULT_TASKS,
  examLeadDays: 7,
  updatedAt: 0,
  sessions: [
    { id: "s1", week: 1, kind: "lecture", topic: "Thoracic wall", start: day(12, 9), allDay: false },
    { id: "s2", week: 1, kind: "lab", topic: "Dissection", start: day(12, 14), allDay: false },
  ],
};

function userSettings(over: Partial<EmailSettings> = {}): EmailSettings {
  return {
    ...DEFAULT_EMAIL_SETTINGS,
    enabled: true,
    email: "student@example.edu",
    timeZone: TZ,
    daily: { enabled: true, atMinutes: 18 * 60, days: [0, 1, 2, 3, 4, 5, 6] },
    weekly: { enabled: false, weekday: 0, atMinutes: 0 },
    exam: { enabled: false, leadDays: [] },
    ...over,
  };
}

interface Store {
  [path: string]: Record<string, unknown>;
}

interface Harness {
  store: Store;
  sent: { to: string; subject: string; html: string; text: string }[];
  patches: { path: string; fields: Record<string, unknown>; mask: string[] }[];
  gets: number;
  env: Parameters<typeof run>[0];
}

function harness(store: Store, broken: string[] = []): Harness {
  const sent: Harness["sent"] = [];
  const patches: Harness["patches"] = [];
  const h = { store, sent, patches, gets: 0 } as Harness;

  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });

    if (url.hostname === "oauth2.googleapis.com") {
      return json({ access_token: "test-token", expires_in: 3600 });
    }
    const prefix = "/v1/projects/med-quizlet/databases/(default)/documents/";
    const path = decodeURIComponent(url.pathname.slice(prefix.length));

    if (init?.method === "PATCH") {
      const fields = JSON.parse(String(init.body)).fields as Record<string, unknown>;
      patches.push({
        path,
        fields,
        mask: url.searchParams.getAll("updateMask.fieldPaths"),
      });
      return json({});
    }

    h.gets++;
    if (broken.includes(path)) return json({ error: "boom" }, 500);

    // A collection listing rather than a single document.
    if (!path.includes("/") && path === "emailReminders") {
      const documents = Object.entries(store)
        .filter(([p]) => p.startsWith("emailReminders/"))
        .map(([p, fields]) => ({
          name: `projects/med-quizlet/databases/(default)/documents/${p}`,
          fields: encodeFields(fields),
        }));
      return json({ documents });
    }
    const doc = store[path];
    if (!doc) return json({}, 404);
    return json({ fields: encodeFields(doc) });
  }) as typeof fetch;

  h.env = {
    FIREBASE_SERVICE_ACCOUNT: SERVICE_ACCOUNT,
    MAIL_FROM: "reminders@recallis.org",
    MAIL_FROM_NAME: "Recallis",
    EMAIL: {
      async send(message) {
        sent.push({
          to: String(message.to),
          subject: message.subject,
          html: message.html ?? "",
          text: message.text ?? "",
        });
      },
    },
  };
  return h;
}

const SERVICE_ACCOUNT = await makeServiceAccount();

// ---------- an ordinary run ----------
console.log("a run with one account behind:");
{
  const h = harness({
    "emailReminders/u1": userSettings() as unknown as Record<string, unknown>,
    "users/u1/planner/plan": planDoc,
  });
  const report = await run(h.env, evening);

  check("it found the account", report.accounts === 1);
  check("which had something due", report.served === 1);
  check("and one email went out", report.sent === 1, `${report.sent}`);
  check("nothing failed", report.failures.length === 0, report.failures.join("; "));
  check("addressed to them", h.sent[0]?.to === "student@example.edu");
  check(
    "naming what's open",
    h.sent[0]?.subject === "2 sessions still open from today",
    h.sent[0]?.subject
  );
  check("with a real HTML body", h.sent[0]?.html.includes("Thoracic wall"));
  check("and a plain-text one", h.sent[0]?.text.includes("Thoracic wall"));
  check(
    "the send is recorded so it can't repeat",
    h.patches[0]?.path === "emailReminders/u1" &&
      h.patches[0].mask.join() === "sent",
    JSON.stringify(h.patches[0]?.mask)
  );
  check(
    "under today's key",
    JSON.stringify(h.patches[0]?.fields).includes("daily-2026-08-12")
  );
}

// ---------- the second run of the day ----------
console.log("\nrunning again fifteen minutes later:");
{
  const h = harness({
    "emailReminders/u1": userSettings({
      sent: { "daily-2026-08-12": evening },
    }) as unknown as Record<string, unknown>,
    "users/u1/planner/plan": planDoc,
  });
  const report = await run(h.env, evening + 15 * 60000);
  check("nothing is sent twice", report.sent === 0);
  check("and nothing is written", h.patches.length === 0);
}

// ---------- a finished day ----------
console.log("\nwhen the day's work is done:");
{
  const done: Record<string, boolean> = {};
  for (const id of ["s1", "s2"]) {
    for (const t of DEFAULT_TASKS) done[progressKey(id, t.id)] = true;
  }
  const h = harness({
    "emailReminders/u1": userSettings() as unknown as Record<string, unknown>,
    "users/u1/planner/plan": planDoc,
    "users/u1/planner/progress": { done },
  });
  const report = await run(h.env, evening);
  check("no email arrives", report.sent === 0, "onlyWhenBehind is the default");
}

// ---------- the test email ----------
console.log("\nwhen someone asks for a test:");
{
  const h = harness({
    "emailReminders/u1": userSettings({
      testRequested: evening - 1000,
    }) as unknown as Record<string, unknown>,
    "users/u1/planner/plan": planDoc,
  });
  await run(h.env, evening);
  check("the example goes first", h.sent[0]?.subject.includes("reminders are working"));
  check("along with what was actually due", h.sent.length === 2, `${h.sent.length}`);
  check(
    "and the request is cleared",
    h.patches[0]?.mask.includes("testRequested") &&
      !("testRequested" in (h.patches[0]?.fields ?? {})),
    "in the mask but not the body, which deletes it"
  );
}

// ---------- one broken account ----------
console.log("\nwhen one account is broken:");
{
  const h = harness(
    {
      "emailReminders/u1": userSettings({ email: "one@example.edu" }) as unknown as Record<string, unknown>,
      "emailReminders/u2": userSettings({ email: "two@example.edu" }) as unknown as Record<string, unknown>,
      "users/u1/planner/plan": planDoc,
      "users/u2/planner/plan": planDoc,
    },
    []
  );
  // The second account's email send blows up.
  const realSend = h.env.EMAIL.send;
  h.env.EMAIL.send = async (m) => {
    if (String(m.to) === "two@example.edu") throw new Error("mailbox full");
    return realSend(m);
  };
  const report = await run(h.env, evening);
  check("the healthy account is still served", h.sent.length === 1);
  check("and it's the right one", h.sent[0]?.to === "one@example.edu");
  check("the failure is reported", report.failures.length === 1, report.failures.join());
  check("naming the account", report.failures[0].startsWith("u2:"));
  check(
    "and the broken one isn't marked as sent",
    h.patches.every((p) => p.path !== "emailReminders/u2")
  );
}

// ---------- an account switched off ----------
console.log("\naccounts that want nothing:");
{
  const h = harness({
    "emailReminders/u1": userSettings({ enabled: false }) as unknown as Record<string, unknown>,
    "emailReminders/u2": userSettings({ email: "" }) as unknown as Record<string, unknown>,
    "users/u1/planner/plan": planDoc,
  });
  const report = await run(h.env, evening);
  check("neither is emailed", report.sent === 0);
  check(
    "and neither costs a read of their plan",
    h.gets === 1,
    "just the one listing"
  );
}

// ---------- more accounts than one run can serve ----------
console.log("\nwhen there are more accounts than a run can serve:");
{
  const store: Store = {};
  for (let i = 0; i < 25; i++) {
    store[`emailReminders/u${i}`] = userSettings({
      email: `u${i}@example.edu`,
    }) as unknown as Record<string, unknown>;
    store[`users/u${i}/planner/plan`] = planDoc;
  }
  const h = harness(store);
  const report = await run(h.env, evening);
  check("it stops before running out of budget", report.deferred > 0, `${report.deferred} deferred`);
  check("having served as many as it could", report.sent > 5, `${report.sent} sent`);
  check(
    "and remembers where it stopped",
    h.patches.some((p) => p.path === "plannerMeta/mailer"),
    "so the next tick starts there rather than at the top again"
  );

  const cursor = h.patches.find((p) => p.path === "plannerMeta/mailer");
  const at = Number(
    (cursor?.fields.at as { integerValue?: string })?.integerValue ?? 0
  );
  check("the cursor points past the ones just served", at > 0, `at=${at}`);

  // Next tick: the ones already emailed are recorded, so it moves on.
  const served = new Set(h.sent.map((s) => s.to));
  for (const [path, doc] of Object.entries(store)) {
    if (!path.startsWith("emailReminders/")) continue;
    if (served.has(String(doc.email))) {
      doc.sent = { "daily-2026-08-12": evening };
    }
  }
  store["plannerMeta/mailer"] = { at };
  const h2 = harness(store);
  const report2 = await run(h2.env, evening + 15 * 60000);
  const twice = h2.sent.filter((s) => served.has(s.to));
  check("the next run sends to the rest", report2.sent > 0, `${report2.sent}`);
  check("and to nobody twice", twice.length === 0, `${twice.length} repeats`);
}

// ---------- the fallback provider ----------
// Cloudflare Email Sending has to be enabled on the account first. Until it
// is, a RESEND_API_KEY makes the same Worker work unchanged.
console.log("\nsending through Resend instead:");
{
  const h = harness({
    "emailReminders/u1": userSettings() as unknown as Record<string, unknown>,
    "users/u1/planner/plan": planDoc,
  });
  const posted: { url: string; body: Record<string, unknown> }[] = [];
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.startsWith("https://api.resend.com")) {
      posted.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    }
    return inner(input as string, init);
  }) as typeof fetch;

  h.env.RESEND_API_KEY = "test-key";
  h.env.EMAIL = undefined;
  const report = await run(h.env, evening);
  check("the email still goes out", report.sent === 1, report.failures.join());
  check("through the provider", posted.length === 1);
  check(
    "from the configured address",
    posted[0]?.body.from === "Recallis <reminders@recallis.org>",
    String(posted[0]?.body.from)
  );
  check("to the right person", JSON.stringify(posted[0]?.body.to) === '["student@example.edu"]');
  check("with both parts", Boolean(posted[0]?.body.html) && Boolean(posted[0]?.body.text));
}

console.log("\nwith no way to send at all:");
{
  const h = harness({
    "emailReminders/u1": userSettings() as unknown as Record<string, unknown>,
    "users/u1/planner/plan": planDoc,
  });
  h.env.EMAIL = undefined;
  const report = await run(h.env, evening);
  check("it fails loudly rather than silently", report.failures.length === 1);
  check(
    "saying what to do about it",
    report.failures[0].includes("Email Sending") && report.failures[0].includes("RESEND_API_KEY"),
    report.failures[0]
  );
  check("and doesn't record a send that never happened", h.patches.length === 0);
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
