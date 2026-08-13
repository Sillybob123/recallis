// Turning a reminder into an email someone is glad to get.
//
// Email clients are twenty years behind browsers: Gmail strips <style>
// blocks, Outlook renders through Word, and flexbox is not an option. So
// this is tables and inline styles on purpose — it is the only thing that
// renders the same everywhere.
//
// The design goal is a message you can act on from the lock screen: one
// headline that says how much is left, the specific items under it with the
// steps you haven't ticked, and a single button. No images, so nothing is
// blocked; no tracking pixel, because there is nothing here worth tracking.

import type { EmailJob, EmailSection } from "./emailReminders";

const APP_URL = "https://recallis.org/planner";

const INK = "#0f172a";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const BRAND = "#4f46e5";
const ALERT = "#b91c1c";
const ALERT_BG = "#fef2f2";
const GOOD = "#047857";
const GOOD_BG = "#ecfdf5";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Every attribute below is double-quoted, so this is belt and braces —
    // but the cost is nothing and the day someone writes a single-quoted one
    // it is already handled.
    .replace(/'/g, "&#39;");
}

/**
 * Makes a string safe to put in a mail header.
 *
 * Headers are newline-delimited, so a value containing CR or LF is a way to
 * append headers of one's own — a Bcc, a different Reply-To. The feedback
 * sender builds a Subject out of a name typed into a form, and the rules
 * bound that field's length but cannot bound what's in it, so the stripping
 * happens here. Control characters go too, and the result is clipped: a
 * subject line of hundreds of characters is folded or truncated by the
 * transport anyway, usually less tidily than this.
 */
export function headerSafe(s: string, max = 200): string {
  const flat = s
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function toneColors(tone: EmailSection["tone"]): { ink: string; bg: string } {
  if (tone === "alert") return { ink: ALERT, bg: ALERT_BG };
  if (tone === "good") return { ink: GOOD, bg: GOOD_BG };
  return { ink: INK, bg: "#f8fafc" };
}

/**
 * A step chip. A tick or an empty circle, drawn with characters rather than
 * images so it survives a client that blocks remote content — which is most
 * of them, by default.
 */
function chip(label: string, done: boolean): string {
  const bg = done ? "#dcfce7" : "#ffffff";
  const ink = done ? "#15803d" : MUTED;
  const border = done ? "#86efac" : LINE;
  const mark = done ? "&#10003;" : "&#9675;";
  return (
    `<span style="display:inline-block;margin:2px 4px 2px 0;padding:3px 8px;` +
    `border:1px solid ${border};border-radius:999px;background:${bg};` +
    `color:${ink};font-size:12px;font-weight:600;line-height:1;white-space:nowrap;">` +
    `${mark}&nbsp;${esc(label)}</span>`
  );
}

function sectionHtml(section: EmailSection): string {
  const { ink, bg } = toneColors(section.tone);
  const rows = section.lines
    .map(
      (line) => `
      <tr>
        <td style="padding:12px 16px;border-top:1px solid ${LINE};">
          <div style="font-size:15px;font-weight:700;color:${INK};line-height:1.35;">${esc(
            line.title
          )}</div>
          ${
            line.meta
              ? `<div style="font-size:12px;color:${MUTED};margin-top:2px;">${esc(line.meta)}</div>`
              : ""
          }
          ${
            line.steps?.length
              ? `<div style="margin-top:8px;">${line.steps
                  .map((s) => chip(s.label, s.done))
                  .join("")}</div>`
              : ""
          }
        </td>
      </tr>`
    )
    .join("");

  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid ${LINE};border-radius:12px;overflow:hidden;margin:0 0 16px;">
    <tr>
      <td style="padding:10px 16px;background:${bg};">
        <div style="font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${ink};">${esc(
          section.title
        )}</div>
        ${
          section.note
            ? `<div style="font-size:13px;color:${MUTED};margin-top:4px;line-height:1.5;">${esc(
                section.note
              )}</div>`
            : ""
        }
      </td>
    </tr>
    ${rows}
  </table>`;
}

export function renderEmailHtml(job: EmailJob, unsubscribeNote?: string): string {
  const body = job.sections.map(sectionHtml).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(job.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <!-- Shown in the inbox list under the subject, so the first line of the
       preview is useful rather than "View this email in your browser". -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(job.intro)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <tr>
            <td style="padding:20px 24px 0;">
              <div style="font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${BRAND};">Recallis</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 0;">
              <h1 style="margin:0;font-size:26px;line-height:1.2;color:${INK};font-weight:800;">${esc(
                job.heading
              )}</h1>
              <p style="margin:10px 0 20px;font-size:15px;line-height:1.6;color:${MUTED};">${esc(
                job.intro
              )}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px;">
              ${body}
            </td>
          </tr>
          <tr>
            <td style="padding:4px 24px 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:${BRAND};border-radius:10px;">
                    <a href="${APP_URL}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Open your planner &rarr;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px;border-top:1px solid ${LINE};background:#f8fafc;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">
                ${esc(
                  unsubscribeNote ??
                    "You're getting this because you turned on email reminders in the Recallis planner."
                )}
                Change the times or switch them off under <b>Email reminders</b> in the planner.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** The plain-text alternative. Required if you'd like to reach an inbox. */
export function renderEmailText(job: EmailJob): string {
  const out = [job.heading.toUpperCase(), "", job.intro, ""];
  for (const section of job.sections) {
    out.push(`— ${section.title} —`);
    if (section.note) out.push(section.note);
    for (const line of section.lines) {
      out.push(`  • ${line.title}${line.meta ? ` (${line.meta})` : ""}`);
      const left = (line.steps ?? []).filter((s) => !s.done).map((s) => s.label);
      if (left.length) out.push(`      still to do: ${left.join(", ")}`);
    }
    out.push("");
  }
  out.push(`Open your planner: ${APP_URL}`);
  out.push("");
  out.push(
    "You're getting this because you turned on email reminders in the Recallis planner. Change or stop them under Email reminders in the planner."
  );
  return out.join("\n");
}
