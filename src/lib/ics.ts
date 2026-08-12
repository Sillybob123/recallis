// Reading a course calendar (.ics) into a list of sessions.
//
// Medical school timetables are published as iCalendar feeds, and that file
// already knows everything the planner needs: what each session is, when it
// is, and which of them are assessments. Parsing it beats typing a semester
// in by hand.
//
// This is a deliberately small subset of RFC 5545 — enough for a published
// timetable, and honest about what it skips rather than guessing.

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  /** epoch ms */
  start: number;
  end?: number;
  /** true when the source gave a date with no time */
  allDay: boolean;
}

export interface IcsParseResult {
  events: IcsEvent[];
  /** things the file contained that this parser doesn't reproduce */
  warnings: string[];
}

/**
 * Long values are split across lines, with continuations marked by a leading
 * space or tab. Undo that before anything else, or a summary breaks in half.
 */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseProperty(line: string): Property | null {
  // The first unquoted colon separates the name-and-params from the value.
  let colon = -1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(";");
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq > 0) {
      params[part.slice(0, eq).toUpperCase()] = part
        .slice(eq + 1)
        .replace(/^"|"$/g, "");
    }
  }
  return { name: name.toUpperCase(), params, value };
}

/** Text values escape commas, semicolons and newlines. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/**
 * Turns a DTSTART/DTEND value into epoch ms.
 *
 * A trailing Z is UTC. Anything else — a floating time, or one tagged with a
 * TZID — is read as local, which is what a student sitting in the timezone
 * the timetable was written for actually wants. Converting properly would
 * need the IANA database.
 */
export function parseIcsDate(
  value: string,
  params: Record<string, string> = {}
): { at: number; allDay: boolean } | null {
  const v = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return {
      at: new Date(Number(y), Number(m) - 1, Number(d)).getTime(),
      allDay: true,
    };
  }
  const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!full) return null;
  const [, y, m, d, hh, mm, ss, z] = full;
  const parts = [
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss),
  ] as const;
  const at = z
    ? Date.UTC(...parts)
    : new Date(...parts).getTime();
  return { at, allDay: params.VALUE === "DATE" };
}

/** Expands the simple repeats a timetable actually uses. */
function expandRecurrence(
  event: IcsEvent,
  rrule: string,
  warnings: string[]
): IcsEvent[] {
  const parts: Record<string, string> = {};
  for (const bit of rrule.split(";")) {
    const eq = bit.indexOf("=");
    if (eq > 0) parts[bit.slice(0, eq).toUpperCase()] = bit.slice(eq + 1);
  }
  const freq = parts.FREQ?.toUpperCase();
  const step =
    freq === "WEEKLY" ? 7 * 86400000 : freq === "DAILY" ? 86400000 : 0;
  if (!step) {
    warnings.push(
      `"${event.summary}" repeats in a way this reader doesn't expand (${freq ?? "unknown"}), so only the first occurrence was imported.`
    );
    return [event];
  }
  const interval = Math.max(1, Number(parts.INTERVAL ?? 1));
  const until = parts.UNTIL ? parseIcsDate(parts.UNTIL)?.at : undefined;
  const count = parts.COUNT ? Number(parts.COUNT) : undefined;
  // A malformed rule must not spin forever.
  const LIMIT = 200;
  const out: IcsEvent[] = [];
  const duration = event.end ? event.end - event.start : 0;
  for (let i = 0; i < LIMIT; i++) {
    const start = event.start + i * step * interval;
    if (until !== undefined && start > until) break;
    if (count !== undefined && i >= count) break;
    if (count === undefined && until === undefined && i >= 52) break;
    out.push({
      ...event,
      uid: i === 0 ? event.uid : `${event.uid}#${i}`,
      start,
      end: duration ? start + duration : undefined,
    });
  }
  return out.length ? out : [event];
}

export function parseIcs(text: string): IcsParseResult {
  const lines = unfold(text);
  const events: IcsEvent[] = [];
  const warnings: string[] = [];
  let current: Partial<IcsEvent> & { rrule?: string } | null = null;
  let depth = 0;

  for (const line of lines) {
    const prop = parseProperty(line);
    if (!prop) continue;

    if (prop.name === "BEGIN" && prop.value === "VEVENT") {
      current = {};
      depth = 1;
      continue;
    }
    if (prop.name === "END" && prop.value === "VEVENT") {
      if (current && current.summary && typeof current.start === "number") {
        const event: IcsEvent = {
          uid: current.uid || `${current.summary}-${current.start}`,
          summary: current.summary,
          description: current.description,
          location: current.location,
          start: current.start,
          end: current.end,
          allDay: Boolean(current.allDay),
        };
        events.push(
          ...(current.rrule
            ? expandRecurrence(event, current.rrule, warnings)
            : [event])
        );
      }
      current = null;
      depth = 0;
      continue;
    }
    // Alarms and other nested blocks carry their own DTSTART; ignore them.
    if (prop.name === "BEGIN") depth++;
    if (prop.name === "END") depth--;
    if (!current || depth !== 1) continue;

    switch (prop.name) {
      case "UID":
        current.uid = prop.value;
        break;
      case "SUMMARY":
        current.summary = unescapeText(prop.value).trim();
        break;
      case "DESCRIPTION":
        current.description = unescapeText(prop.value).trim();
        break;
      case "LOCATION":
        current.location = unescapeText(prop.value).trim();
        break;
      case "DTSTART": {
        const parsed = parseIcsDate(prop.value, prop.params);
        if (parsed) {
          current.start = parsed.at;
          current.allDay = parsed.allDay;
        }
        break;
      }
      case "DTEND": {
        const parsed = parseIcsDate(prop.value, prop.params);
        if (parsed) current.end = parsed.at;
        break;
      }
      case "RRULE":
        current.rrule = prop.value;
        break;
    }
  }

  events.sort((a, b) => a.start - b.start);
  return { events, warnings };
}
