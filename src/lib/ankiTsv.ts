// Anki text-export format: optional "#key:value" header directives followed by
// separator-delimited rows. Fields may be quoted CSV-style (quotes doubled,
// fields can span multiple lines).

export interface AnkiFileHeaders {
  separator: string;
  html: boolean;
  guidColumn?: number; // 1-indexed, as Anki writes them
  notetypeColumn?: number;
  deckColumn?: number;
  tagsColumn?: number;
}

export interface ParsedAnkiFile {
  headers: AnkiFileHeaders;
  rows: string[][];
}

const SEPARATORS: Record<string, string> = {
  tab: "\t",
  comma: ",",
  semicolon: ";",
  colon: ":",
  pipe: "|",
  space: " ",
};

export function parseAnkiFile(text: string): ParsedAnkiFile {
  // Normalize line endings; strip BOM.
  const src = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");

  const headers: AnkiFileHeaders = { separator: "\t", html: true };
  let pos = 0;

  // Header directives: lines starting with "#" before any data row.
  while (pos < src.length && src[pos] === "#") {
    const eol = src.indexOf("\n", pos);
    const line = (eol === -1 ? src.slice(pos) : src.slice(pos, eol)).trim();
    pos = eol === -1 ? src.length : eol + 1;

    const m = line.match(/^#\s*([^:]+):(.*)$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase();
    const value = m[2].trim();
    if (key === "separator") {
      headers.separator = SEPARATORS[value.toLowerCase()] ?? value;
    } else if (key === "html") {
      headers.html = value.toLowerCase() === "true";
    } else if (key === "guid column") {
      headers.guidColumn = Number(value);
    } else if (key === "notetype column") {
      headers.notetypeColumn = Number(value);
    } else if (key === "deck column") {
      headers.deckColumn = Number(value);
    } else if (key === "tags column") {
      headers.tagsColumn = Number(value);
    }
  }

  const rows: string[][] = [];
  const sep = headers.separator;
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;

  function endField() {
    row.push(field);
    field = "";
    fieldStarted = false;
  }

  function endRow() {
    endField();
    // Skip rows that are entirely empty (blank lines between records).
    if (row.some((f) => f.trim() !== "")) {
      rows.push(row);
    }
    row = [];
  }

  while (pos < src.length) {
    const ch = src[pos];
    if (inQuotes) {
      if (ch === '"') {
        if (src[pos + 1] === '"') {
          field += '"';
          pos += 2;
        } else {
          inQuotes = false;
          pos += 1;
        }
      } else {
        field += ch;
        pos += 1;
      }
    } else if (ch === '"' && !fieldStarted && field === "") {
      inQuotes = true;
      fieldStarted = true;
      pos += 1;
    } else if (ch === sep) {
      endField();
      pos += 1;
    } else if (ch === "\n") {
      endRow();
      pos += 1;
    } else {
      field += ch;
      fieldStarted = true;
      pos += 1;
    }
  }
  if (field !== "" || row.length > 0) {
    endRow();
  }

  return { headers, rows };
}

function quoteField(value: string, sep: string): string {
  if (
    value.includes(sep) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/** Serializes rows into Anki's header-directive TSV format (Text2Anki style). */
export function serializeAnkiFile(
  rows: string[][],
  opts: {
    notetypeColumn?: number;
    deckColumn?: number;
    tagsColumn?: number;
    html?: boolean;
  } = {}
): string {
  const lines: string[] = ["#separator:tab", `#html:${opts.html !== false}`];
  if (opts.notetypeColumn) lines.push(`#notetype column:${opts.notetypeColumn}`);
  if (opts.deckColumn) lines.push(`#deck column:${opts.deckColumn}`);
  if (opts.tagsColumn) lines.push(`#tags column:${opts.tagsColumn}`);
  for (const row of rows) {
    lines.push(row.map((f) => quoteField(f, "\t")).join("\t"));
  }
  return lines.join("\n") + "\n";
}
