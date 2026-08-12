// Daily study reminders.
//
// An honest note about what this can and cannot do: a web page can only
// notify you while it is open. Real reminders that fire on a closed phone
// need push notifications, which need a server and a service worker.
//
// So this fires the reminder the first time you have Recallis open on or
// after your chosen time each day. That genuinely helps someone who leaves
// the app in a tab, and it is deliberately described that way in the UI
// rather than promising an alarm clock.

export interface ReminderSettings {
  enabled: boolean;
  /** minutes past local midnight */
  atMinutes: number;
  /** ISO date (yyyy-mm-dd) of the last reminder shown */
  lastShown?: string;
}

const KEY = "plannerReminders";

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: false,
  atMinutes: 18 * 60,
};

export function loadReminderSettings(): ReminderSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_REMINDERS };
    return { ...DEFAULT_REMINDERS, ...(JSON.parse(raw) as ReminderSettings) };
  } catch {
    return { ...DEFAULT_REMINDERS };
  }
}

export function saveReminderSettings(s: ReminderSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* best effort */
  }
}

export async function requestReminderPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

function today(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Whether a reminder is due: enabled, permitted, past the chosen time, and
 * not already shown today. Pure, so the decision can be tested without a
 * browser — the notification itself is the caller's business.
 */
export function reminderDue(
  settings: ReminderSettings,
  now: number,
  permission: string
): boolean {
  if (!settings.enabled || permission !== "granted") return false;
  const d = new Date(now);
  const minutes = d.getHours() * 60 + d.getMinutes();
  if (minutes < settings.atMinutes) return false;
  return settings.lastShown !== today(now);
}

/** Marks today as reminded. */
export function markReminded(
  settings: ReminderSettings,
  now = Date.now()
): ReminderSettings {
  return { ...settings, lastShown: today(now) };
}

export function showReminder(body: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification("Recallis — today's study plan", { body });
  } catch {
    /* some browsers refuse outside a user gesture; not worth surfacing */
  }
}
