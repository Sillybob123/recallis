// Parses Anki .apkg / .colpkg packages (both the modern zstd-compressed
// format and the legacy format) entirely client-side: JSZip for the
// container, fzstd for zstd, sql.js (wasm SQLite) for the collection DB.

import JSZip from "jszip";
import { decompress as zstdDecompress } from "fzstd";
import type { Database, SqlJsStatic } from "sql.js";
import type { CardData, OcclusionShape } from "../types";
import { uid } from "./uid";
import { normalizeTags, parseTagString } from "./tags";
import { BlobZip, supportsBlobZip } from "./blobZip";

export interface ParsedSheet {
  /** the note's Anki tags, normalized */
  tags: string[];
  /** "anki:<note id>" (native IO) or "anki-ioe:<shared prefix>" */
  importId: string;
  title: string;
  imageName: string;
  imageWidth: number;
  imageHeight: number;
  shapes: OcclusionShape[];
  /** true when shape coords are in pixels and must be divided by image dims */
  needsPixelNormalize?: boolean;
  /**
   * Anki's scheduling for each study unit, in unit order. Each mask of an
   * Image Occlusion note is its own card over there, so each keeps its own
   * due date.
   */
  unitSchedules?: (ImportedSchedule | undefined)[];
}

/** A card's scheduling as Anki stored it, already converted to our shape. */
export interface ImportedSchedule {
  /** never answered — keep it new, but remember suspended/buried state */
  isNew: boolean;
  phase: "learn" | "review" | "relearn";
  /** epoch ms */
  due: number;
  /** interval in days */
  ivl: number;
  ease: number;
  reps: number;
  lapses: number;
  suspended: boolean;
  buried: boolean;
}

export interface ParsedCard {
  data: CardData;
  /** the note's Anki tags, normalized */
  tags: string[];
  /** "anki:<note id>" — stable across exports of the same collection */
  importId: string;
  /** keyed by cloze number (1-based); basic cards use 1 */
  schedule?: Map<number, ImportedSchedule>;
}

export interface ParsedApkgDeck {
  /** "Anatomy::Lab00::Positions" style */
  name: string;
  cards: ParsedCard[];
  sheets: ParsedSheet[];
}

export interface ParsedApkg {
  decks: ParsedApkgDeck[];
  /** media filename -> zip entry name ("0", "1", ...) */
  mediaIndex: Map<string, string>;
  /** modern format = media files are individually zstd-compressed */
  zstdMedia: boolean;
  /** kept so media can be read lazily, one entry at a time */
  pkg: OpenApkg;
  stats: {
    cloze: number;
    basic: number;
    sheets: number;
    masks: number;
    skippedNotes: number;
    /** notes left out because every card of theirs was suspended */
    suspendedSkipped: number;
    /** cards that arrived with real scheduling we can preserve */
    scheduled: number;
    warnings: string[];
  };
}

const ZSTD_MAGIC = 0xfd2fb528;

function isZstd(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  const view = new DataView(data.buffer, data.byteOffset, 4);
  return view.getUint32(0, true) === ZSTD_MAGIC;
}

function maybeDecompress(data: Uint8Array): Uint8Array {
  return isZstd(data) ? zstdDecompress(data) : data;
}

// ---------- media map ----------

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  for (;;) {
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return [result, pos];
    shift += 7;
  }
}

/** Modern media map: zstd-compressed protobuf, repeated MediaEntry{name=1,...} in file order. */
function parseMediaProtobuf(raw: Uint8Array): string[] {
  const names: string[] = [];
  const decoder = new TextDecoder();
  let pos = 0;
  while (pos < raw.length) {
    let tag: number;
    [tag, pos] = readVarint(raw, pos);
    const wireType = tag & 7;
    if (wireType === 2) {
      let len: number;
      [len, pos] = readVarint(raw, pos);
      const payload = raw.subarray(pos, pos + len);
      pos += len;
      if (tag >> 3 === 1) {
        // nested MediaEntry
        let npos = 0;
        while (npos < payload.length) {
          let ntag: number;
          [ntag, npos] = readVarint(payload, npos);
          const nwt = ntag & 7;
          if (nwt === 2) {
            let nlen: number;
            [nlen, npos] = readVarint(payload, npos);
            if (ntag >> 3 === 1) {
              names.push(decoder.decode(payload.subarray(npos, npos + nlen)));
            }
            npos += nlen;
          } else if (nwt === 0) {
            [, npos] = readVarint(payload, npos);
          } else {
            return names; // unknown wire type; stop safely
          }
        }
      }
    } else if (wireType === 0) {
      [, pos] = readVarint(raw, pos);
    } else {
      break;
    }
  }
  return names;
}

async function buildMediaIndex(
  pkg: OpenApkg
): Promise<{ index: Map<string, string>; zstdMedia: boolean }> {
  const index = new Map<string, string>();
  const raw = await pkg.readEntry("media");
  if (!raw) return { index, zstdMedia: false };
  if (isZstd(raw)) {
    const names = parseMediaProtobuf(zstdDecompress(raw));
    names.forEach((name, i) => index.set(name, String(i)));
    return { index, zstdMedia: true };
  }
  // Legacy: JSON map { "0": "filename" }
  const map = JSON.parse(new TextDecoder().decode(raw)) as Record<string, string>;
  for (const [entry, name] of Object.entries(map)) {
    index.set(name, entry);
  }
  return { index, zstdMedia: false };
}

export async function readMediaBytes(
  parsed: Pick<ParsedApkg, "pkg" | "mediaIndex" | "zstdMedia">,
  name: string
): Promise<Uint8Array | null> {
  const entry = parsed.mediaIndex.get(name);
  if (entry === undefined) return null;
  const raw = await parsed.pkg.readEntry(entry);
  if (!raw) return null;
  return parsed.zstdMedia ? maybeDecompress(raw) : raw;
}

// ---------- SVG mask parsing (Image Occlusion Enhanced) ----------

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function shapeFromSvgTag(
  tagName: string,
  attrs: Record<string, string>,
  W: number,
  H: number,
  groupId?: string
): OcclusionShape | null {
  const id = uid();
  if (tagName === "rect") {
    const x = parseFloat(attrs.x ?? "0") / W;
    const y = parseFloat(attrs.y ?? "0") / H;
    const w = parseFloat(attrs.width ?? "0") / W;
    const h = parseFloat(attrs.height ?? "0") / H;
    if (w <= 0 || h <= 0) return null;
    return { id, kind: "rect", x, y, w, h, groupId };
  }
  if (tagName === "ellipse") {
    const cx = parseFloat(attrs.cx ?? "0") / W;
    const cy = parseFloat(attrs.cy ?? "0") / H;
    const rx = parseFloat(attrs.rx ?? "0") / W;
    const ry = parseFloat(attrs.ry ?? "0") / H;
    if (rx <= 0 || ry <= 0) return null;
    return { id, kind: "ellipse", x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2, groupId };
  }
  if (tagName === "polygon") {
    const points = (attrs.points ?? "")
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [px, py] = pair.split(",").map(Number);
        return { x: px / W, y: py / H };
      })
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (points.length < 3) return null;
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return {
      id,
      kind: "polygon",
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      points,
      groupId,
    };
  }
  return null;
}

/**
 * Parses an IOE "-O.svg" original-mask file. Masks appear either grouped
 * (<g id="...-oa-N"> with several shapes → they reveal together) or as
 * standalone shape elements with their own -oa-N id.
 */
export function parseIoeOriginalSvg(svgText: string): {
  width: number;
  height: number;
  shapes: OcclusionShape[];
  /** the -oa-N number of each mask, aligned with study-unit order */
  maskOrder: number[];
} | null {
  const svgTag = svgText.match(/<svg\b[^>]*>/);
  if (!svgTag) return null;
  const svgAttrs = parseAttrs(svgTag[0]);
  const W = parseFloat(svgAttrs.width ?? "0");
  const H = parseFloat(svgAttrs.height ?? "0");
  if (!W || !H) return null;

  // Strip the Labels group so its decorations don't get mistaken for masks.
  const labelsMatch = svgText.match(/<g>\s*<title>Labels<\/title>[\s\S]*?<\/g>/);
  const body = labelsMatch ? svgText.replace(labelsMatch[0], "") : svgText;

  // Collected as { oaIndex, shapes } so the masks can be emitted in the order
  // Anki numbered them, which is how each IOE note maps to a study card.
  const masks: { oaIndex: number; shapes: OcclusionShape[] }[] = [];
  const consumedRanges: [number, number][] = [];

  // Grouped masks: <g id="...-oa-N"> ... shapes ... </g>.
  // Also matches self-closing empty groups (<g id="..."/>) — stray notes whose
  // masks were deleted — so they can't swallow the following group's shapes.
  for (const gm of body.matchAll(
    /<g\b[^>]*\bid="[^"]*-(?:oa|ao)-(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/g>)/g
  )) {
    consumedRanges.push([gm.index!, gm.index! + gm[0].length]);
    const oaIndex = Number(gm[1]);
    const inner = gm[2];
    if (inner === undefined) continue; // self-closing empty group
    const groupShapes: OcclusionShape[] = [];
    for (const sm of inner.matchAll(/<(rect|ellipse|polygon)\b[^>]*\/?>/g)) {
      const shape = shapeFromSvgTag(sm[1], parseAttrs(sm[0]), W, H);
      if (shape) groupShapes.push(shape);
    }
    if (groupShapes.length === 1) {
      masks.push({ oaIndex, shapes: groupShapes });
    } else if (groupShapes.length > 1) {
      const gid = uid();
      masks.push({
        oaIndex,
        shapes: groupShapes.map((s) => ({ ...s, groupId: gid })),
      });
    }
  }

  // Standalone masks: shape elements with their own -oa-N id, outside groups.
  for (const sm of body.matchAll(
    /<(rect|ellipse|polygon)\b[^>]*\bid="[^"]*-(?:oa|ao)-(\d+)"[^>]*\/?>/g
  )) {
    const inConsumed = consumedRanges.some(
      ([a, b]) => sm.index! >= a && sm.index! < b
    );
    if (inConsumed) continue;
    const shape = shapeFromSvgTag(sm[1], parseAttrs(sm[0]), W, H);
    if (shape) masks.push({ oaIndex: Number(sm[2]), shapes: [shape] });
  }

  masks.sort((a, b) => a.oaIndex - b.oaIndex);
  return {
    width: W,
    height: H,
    shapes: masks.flatMap((m) => m.shapes),
    maskOrder: masks.map((m) => m.oaIndex),
  };
}

// ---------- native Image Occlusion (Anki 2.1.54+) occlusion field ----------

export function parseNativeOcclusionField(field: string): {
  shapes: OcclusionShape[];
  needsPixelNormalize: boolean;
  /** the cloze number behind each study unit, in unit order */
  clozeOrder: number[];
} {
  const shapes: OcclusionShape[] = [];
  const clozeGroups = new Map<string, OcclusionShape[]>();
  let sawPixels = false;

  for (const m of field.matchAll(
    /\{\{c(\d+)::image-occlusion:(rect|ellipse|polygon):([^}]*)\}\}/g
  )) {
    const clozeNum = m[1];
    const kind = m[2] as "rect" | "ellipse" | "polygon";
    const props: Record<string, string> = {};
    for (const part of m[3].split(":")) {
      const eq = part.indexOf("=");
      if (eq > 0) props[part.slice(0, eq)] = part.slice(eq + 1);
    }

    let shape: OcclusionShape | null = null;
    const id = uid();
    if (kind === "rect" || kind === "ellipse") {
      let x: number, y: number, w: number, h: number;
      if (props.rx !== undefined) {
        const rx = parseFloat(props.rx);
        const ry = parseFloat(props.ry ?? props.rx);
        const cx = parseFloat(props.left ?? props.cx ?? "0");
        const cy = parseFloat(props.top ?? props.cy ?? "0");
        x = cx - rx; y = cy - ry; w = rx * 2; h = ry * 2;
      } else {
        x = parseFloat(props.left ?? "0");
        y = parseFloat(props.top ?? "0");
        w = parseFloat(props.width ?? "0");
        h = parseFloat(props.height ?? "0");
      }
      if (w > 0 && h > 0) {
        if (x > 1.5 || y > 1.5 || w > 1.5 || h > 1.5) sawPixels = true;
        shape = { id, kind, x, y, w, h };
      }
    } else {
      const points = (props.points ?? "")
        .trim()
        .split(/\s+/)
        .map((pair) => {
          const [px, py] = pair.split(",").map(Number);
          return { x: px, y: py };
        })
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (points.length >= 3) {
        if (points.some((p) => p.x > 1.5 || p.y > 1.5)) sawPixels = true;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of points) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        shape = {
          id,
          kind: "polygon",
          x: minX,
          y: minY,
          w: maxX - minX,
          h: maxY - minY,
          points,
        };
      }
    }
    if (shape) {
      const list = clozeGroups.get(clozeNum) ?? [];
      list.push(shape);
      clozeGroups.set(clozeNum, list);
    }
  }

  // Emit in cloze order so units line up with Anki's card ordinals.
  const clozeOrder: number[] = [];
  const ordered = [...clozeGroups.entries()].sort(
    (a, b) => Number(a[0]) - Number(b[0])
  );
  for (const [num, members] of ordered) {
    clozeOrder.push(Number(num));
    if (members.length > 1) {
      const gid = uid();
      for (const s of members) shapes.push({ ...s, groupId: gid });
    } else if (members.length === 1) {
      shapes.push(members[0]);
    }
  }

  return { shapes, needsPixelNormalize: sawPixels, clozeOrder };
}

// ---------- collection database ----------

function firstImgSrc(html: string): string | null {
  const m = html.match(/<img\b[^>]*\bsrc="([^"]+)"/i);
  if (!m) return null;
  return m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

interface NoteTypeInfo {
  kind: "cloze" | "basic" | "ioe" | "native-io";
  fieldNames: string[];
}

function classifyNotetype(name: string): NoteTypeInfo["kind"] {
  if (/image\s*occlusion\s*enhanced/i.test(name)) return "ioe";
  if (/image\s*occlusion/i.test(name)) return "native-io";
  if (/cloze/i.test(name)) return "cloze";
  return "basic";
}

/**
 * An opened package. Reading a multi-hundred-megabyte export is the single
 * biggest memory cost here, so the caller opens it once and hands the same
 * handle to the probe, the parse, and every media read.
 */
export interface OpenApkg {
  /** reads one entry by name, or null when it isn't in the archive */
  readEntry: (name: string) => Promise<Uint8Array | null>;
  /** every entry name, for the media map fallback */
  names: () => string[];
  loadSql: () => Promise<SqlJsStatic>;
}

/**
 * Opens a package for reading.
 *
 * Given a Blob on a browser that can inflate natively, only the ZIP directory
 * is read up front and entries are sliced out on demand — a 1 GB collection
 * never has to sit in memory. Otherwise JSZip loads the archive as before.
 */
export async function openApkg(
  source: Blob | ArrayBuffer,
  loadSql: () => Promise<SqlJsStatic>
): Promise<OpenApkg> {
  if (source instanceof Blob && supportsBlobZip()) {
    try {
      const zip = await BlobZip.open(source);
      return {
        readEntry: (name) => zip.read(name),
        names: () => [...zip.entries.keys()],
        loadSql,
      };
    } catch {
      // Unusual archive layout — fall back to the full reader below.
    }
  }
  // JSZip only unwraps a Blob when it can see a FileReader, which hides this
  // branch from any non-browser test. Converting here makes the fallback
  // behave the same everywhere — and costs nothing, since JSZip's own path
  // reads the blob into an ArrayBuffer too.
  const zip = await JSZip.loadAsync(
    source instanceof Blob ? await source.arrayBuffer() : source
  );
  return {
    readEntry: async (name) => {
      const file = zip.file(name);
      return file ? await file.async("uint8array") : null;
    },
    names: () => Object.keys(zip.files),
    loadSql,
  };
}

/** Opens the collection database. Callers must close it when finished. */
async function openDb(pkg: OpenApkg): Promise<Database> {
  let bytes: Uint8Array | null = null;
  for (const name of ["collection.anki21b", "collection.anki21", "collection.anki2"]) {
    bytes = await pkg.readEntry(name);
    if (bytes) break;
  }
  if (!bytes) {
    throw new Error(
      "No Anki database found in this file — is it a .apkg/.colpkg export?"
    );
  }
  if (isZstd(bytes)) bytes = zstdDecompress(bytes);
  const SQL = await pkg.loadSql();
  const db = new SQL.Database(bytes);
  // sql.js has copied the bytes into wasm memory; let the JS copy go.
  bytes = null;
  return db;
}

export interface ApkgProbe {
  /** notes with at least one card you haven't suspended */
  activeNotes: number;
  /** notes whose every card is suspended */
  suspendedNotes: number;
  totalNotes: number;
  totalCards: number;
  suspendedCards: number;
  /** cards carrying review history */
  scheduled: number;
  deckNames: string[];
}

/**
 * First look at a package: SQL aggregates only — no field parsing, no media
 * reads, no SVG masks. Most of its ~1s on a 13,000-note collection is just
 * decompressing the database; the per-note work it skips is what would
 * otherwise dominate. Running this first is what lets the dialog offer the
 * suspended choice before any of the expensive work begins.
 */
export async function probeApkg(pkg: OpenApkg): Promise<ApkgProbe> {
  const db = await openDb(pkg);
  try {
    const one = (sql: string): number => {
      try {
        return Number(db.exec(sql)[0]?.values?.[0]?.[0] ?? 0);
      } catch {
        return 0;
      }
    };
    const totalNotes = one("SELECT COUNT(*) FROM notes");
    const totalCards = one("SELECT COUNT(*) FROM cards");
    const suspendedCards = one("SELECT COUNT(*) FROM cards WHERE queue = -1");
    const scheduled = one("SELECT COUNT(*) FROM cards WHERE type != 0");
    // A note counts as active when any of its cards is not suspended.
    const activeNotes = one(
      "SELECT COUNT(DISTINCT nid) FROM cards WHERE queue != -1"
    );

    const deckNames: string[] = [];
    try {
      const res = db.exec("SELECT name FROM decks");
      for (const [name] of res[0]?.values ?? []) {
        deckNames.push(String(name).split("\x1f").join("::"));
      }
    } catch {
      /* legacy schema keeps decks as JSON; names aren't needed for the probe */
    }

    return {
      activeNotes,
      suspendedNotes: Math.max(0, totalNotes - activeNotes),
      totalNotes,
      totalCards,
      suspendedCards,
      scheduled,
      deckNames,
    };
  } finally {
    db.close();
  }
}

export async function parseApkg(
  pkg: OpenApkg,
  options: { excludeSuspended?: boolean } = {}
): Promise<ParsedApkg> {
  const warnings: string[] = [];

  const db: Database = await openDb(pkg);

  const { index: mediaIndex, zstdMedia } = await buildMediaIndex(pkg);

  try {
    const tableNames = new Set<string>();
    {
      const res = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
      for (const row of res[0]?.values ?? []) tableNames.add(String(row[0]));
    }

    // --- note types + field names + deck names (modern vs legacy schema) ---
    const notetypes = new Map<number, NoteTypeInfo>();
    const deckNames = new Map<number, string>();

    if (tableNames.has("notetypes")) {
      const nt = db.exec("SELECT id, name FROM notetypes");
      for (const [id, name] of nt[0]?.values ?? []) {
        notetypes.set(Number(id), {
          kind: classifyNotetype(String(name)),
          fieldNames: [],
        });
      }
      const fl = db.exec("SELECT ntid, ord, name FROM fields ORDER BY ntid, ord");
      for (const [ntid, , name] of fl[0]?.values ?? []) {
        notetypes.get(Number(ntid))?.fieldNames.push(String(name));
      }
      const dk = db.exec("SELECT id, name FROM decks");
      for (const [id, name] of dk[0]?.values ?? []) {
        deckNames.set(Number(id), String(name).split("\x1f").join("::"));
      }
    } else {
      // Legacy schema 11: models/decks live as JSON blobs in the col table.
      const col = db.exec("SELECT models, decks FROM col");
      const [modelsJson, decksJson] = col[0].values[0];
      const models = JSON.parse(String(modelsJson)) as Record<
        string,
        { name: string; flds: { name: string; ord: number }[] }
      >;
      for (const [id, m] of Object.entries(models)) {
        notetypes.set(Number(id), {
          kind: classifyNotetype(m.name),
          fieldNames: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
        });
      }
      const decks = JSON.parse(String(decksJson)) as Record<string, { name: string }>;
      for (const [id, d] of Object.entries(decks)) {
        deckNames.set(Number(id), d.name);
      }
    }

    // --- scheduling, keyed by note id then card ordinal ---
    // Anki stores review due dates as day offsets from the collection's
    // creation day, and learning steps as absolute epoch seconds.
    const schedules = new Map<number, Map<number, ImportedSchedule>>();
    let scheduledCount = 0;
    let suspendedSkipped = 0;
    {
      let crtSeconds = 0;
      try {
        const colRes = db.exec("SELECT crt FROM col");
        crtSeconds = Number(colRes[0]?.values?.[0]?.[0] ?? 0);
      } catch {
        /* no col row; treat everything as new */
      }
      const dayMs = 86400000;
      const res = db.exec(
        "SELECT nid, ord, type, queue, due, ivl, factor, reps, lapses FROM cards"
      );
      for (const row of res[0]?.values ?? []) {
        const [nid, ord, type, queue, due, ivl, factor, reps, lapses] = row.map(Number);
        const suspended = queue === -1;
        const buried = queue === -2 || queue === -3;

        // A new card carries no schedule, but a suspended or buried one must
        // stay that way — a collection can hold thousands of parked new cards
        // that would otherwise flood the queue on import.
        if (type === 0) {
          if (!suspended && !buried) continue;
          const byOrdNew = schedules.get(nid) ?? new Map<number, ImportedSchedule>();
          byOrdNew.set(ord + 1, {
            isNew: true,
            phase: "learn",
            due: Date.now(),
            ivl: 0,
            ease: 2.5,
            reps: 0,
            lapses: 0,
            suspended,
            buried,
          });
          schedules.set(nid, byOrdNew);
          continue;
        }
        let dueMs: number;
        let phase: ImportedSchedule["phase"];
        if (type === 2) {
          phase = "review";
          dueMs = (crtSeconds + due * 86400) * 1000;
        } else {
          phase = type === 3 ? "relearn" : "learn";
          // Learning due values are epoch seconds; very small ones are day
          // offsets from an older scheduler.
          dueMs = due > 1e9 ? due * 1000 : (crtSeconds + due * 86400) * 1000;
        }
        const entry: ImportedSchedule = {
          isNew: false,
          phase,
          due: dueMs,
          ivl: Math.max(0, Math.round(ivl)),
          ease: factor > 0 ? factor / 1000 : 2.5,
          reps: Math.max(reps, 1),
          lapses,
          suspended,
          buried,
        };
        const byOrd = schedules.get(nid) ?? new Map<number, ImportedSchedule>();
        // Anki card ordinals are 0-based; cloze numbers are 1-based.
        byOrd.set(ord + 1, entry);
        schedules.set(nid, byOrd);
        scheduledCount++;
        void dayMs;
      }
    }

    // Which notes still have an unsuspended card. Filtering here means the
    // expensive work below — field parsing, and especially reading and
    // decompressing SVG masks out of the zip — never runs for the thousands
    // of parked cards a big collection carries.
    const activeNoteIds = new Set<number>();
    if (options.excludeSuspended) {
      try {
        const res = db.exec("SELECT DISTINCT nid FROM cards WHERE queue != -1");
        for (const [nid] of res[0]?.values ?? []) activeNoteIds.add(Number(nid));
      } catch {
        /* can't tell — fall through and import everything */
      }
    }
    const isActiveNote = (noteId: number) =>
      !options.excludeSuspended || activeNoteIds.size === 0 || activeNoteIds.has(noteId);

    // --- note -> deck via its first card ---
    const noteDeck = new Map<number, number>();
    {
      const res = db.exec("SELECT nid, did FROM cards");
      for (const [nid, did] of res[0]?.values ?? []) {
        if (!noteDeck.has(Number(nid))) noteDeck.set(Number(nid), Number(did));
      }
    }

    // --- read notes ---
    interface RawNote {
      id: number;
      ntInfo: NoteTypeInfo;
      fields: string[];
      deckName: string;
      /** Anki stores these space-separated and space-padded */
      tags: string[];
    }
    const rawNotes: RawNote[] = [];
    {
      const res = db.exec("SELECT id, mid, flds, tags FROM notes");
      for (const [id, mid, flds, tags] of res[0]?.values ?? []) {
        const ntInfo = notetypes.get(Number(mid));
        if (!ntInfo) continue;
        if (!isActiveNote(Number(id))) {
          suspendedSkipped++;
          continue;
        }
        const did = noteDeck.get(Number(id));
        rawNotes.push({
          id: Number(id),
          ntInfo,
          fields: String(flds).split("\x1f"),
          deckName: (did !== undefined && deckNames.get(did)) || "Imported",
          tags: parseTagString(String(tags ?? "")),
        });
      }
    }

    // --- convert ---
    const deckMap = new Map<string, ParsedApkgDeck>();
    function deckFor(name: string): ParsedApkgDeck {
      let d = deckMap.get(name);
      if (!d) {
        d = { name, cards: [], sheets: [] };
        deckMap.set(name, d);
      }
      return d;
    }

    const stats = {
      cloze: 0,
      basic: 0,
      sheets: 0,
      masks: 0,
      skippedNotes: 0,
      suspendedSkipped: 0,
      scheduled: 0,
      warnings,
    };

    function fieldByName(note: RawNote, name: string, fallback: number): string {
      const idx = note.ntInfo.fieldNames.findIndex(
        (f) => f.toLowerCase() === name.toLowerCase()
      );
      return note.fields[idx >= 0 ? idx : fallback] ?? "";
    }

    // IOE notes are one-note-per-mask sharing an ID prefix; group them into
    // one sheet per original image.
    const ioeGroups = new Map<string, RawNote[]>();

    for (const note of rawNotes) {
      const kind = note.ntInfo.kind;
      if (kind === "ioe") {
        const noteId = fieldByName(note, "ID (hidden)", 0);
        const prefix = noteId.replace(/-(?:oa|ao)-\d+$/, "") || `note-${note.id}`;
        const list = ioeGroups.get(prefix) ?? [];
        list.push(note);
        ioeGroups.set(prefix, list);
        continue;
      }
      if (kind === "native-io") {
        const occlusion = fieldByName(note, "Occlusion", 0);
        const imageHtml = fieldByName(note, "Image", 1);
        const header = fieldByName(note, "Header", 2);
        const imageName = firstImgSrc(imageHtml);
        const { shapes, needsPixelNormalize, clozeOrder } =
          parseNativeOcclusionField(occlusion);
        if (!imageName || shapes.length === 0) {
          stats.skippedNotes++;
          continue;
        }
        // Native occlusion notes make one card per cloze number, so each
        // mask carries its own schedule just like a cloze deletion.
        const byOrd = schedules.get(note.id);
        const unitSchedules = byOrd
          ? clozeOrder.map((num) => byOrd.get(num))
          : undefined;
        deckFor(note.deckName).sheets.push({
          tags: note.tags,
          importId: `anki:${note.id}`,
          title: header.trim() || imageName,
          imageName,
          imageWidth: 0, // resolved when the image is loaded at import time
          imageHeight: 0,
          shapes,
          needsPixelNormalize,
          unitSchedules:
            unitSchedules && unitSchedules.some(Boolean) ? unitSchedules : undefined,
        });
        stats.sheets++;
        stats.masks += shapes.length;
        continue;
      }
      // cloze / basic
      const first = (note.fields[0] ?? "").trim();
      const second = (note.fields[1] ?? "").trim();
      if (!first) {
        stats.skippedNotes++;
        continue;
      }
      const schedule = schedules.get(note.id);
      if (kind === "cloze" && /\{\{c\d+::/.test(first)) {
        deckFor(note.deckName).cards.push({
          data: { type: "cloze", text: first, extra: second || undefined },
          schedule,
          tags: note.tags,
          importId: `anki:${note.id}`,
        });
        stats.cloze++;
      } else if (second) {
        deckFor(note.deckName).cards.push({
          data: { type: "basic", front: first, back: second },
          schedule,
          tags: note.tags,
          importId: `anki:${note.id}`,
        });
        stats.basic++;
      } else {
        stats.skippedNotes++;
      }
    }

    // Resolve IOE groups into sheets by parsing their -O.svg mask files.
    for (const [prefix, notes] of ioeGroups) {
      const sample = notes[0];
      const imageName = firstImgSrc(fieldByName(sample, "Image", 2));
      const maskSvgName = firstImgSrc(fieldByName(sample, "Original Mask", 10));
      if (!imageName || !maskSvgName) {
        stats.skippedNotes += notes.length;
        warnings.push(`Occlusion group ${prefix}: missing image or mask reference.`);
        continue;
      }
      const svgBytes = await readMediaBytes({ pkg, mediaIndex, zstdMedia }, maskSvgName);
      if (!svgBytes) {
        stats.skippedNotes += notes.length;
        warnings.push(
          `Occlusion group ${prefix}: mask file ${maskSvgName} not found in package media.`
        );
        continue;
      }
      const parsed = parseIoeOriginalSvg(new TextDecoder().decode(svgBytes));
      if (!parsed || parsed.shapes.length === 0) {
        stats.skippedNotes += notes.length;
        warnings.push(`Occlusion group ${prefix}: could not read any masks from ${maskSvgName}.`);
        continue;
      }
      const header = fieldByName(sample, "Header", 1).trim();

      // Each IOE note owns one mask, identified by the -oa-N in its ID field.
      const scheduleByOa = new Map<number, ImportedSchedule>();
      for (const n of notes) {
        const noteId = fieldByName(n, "ID (hidden)", 0);
        const m = noteId.match(/-(?:oa|ao)-(\d+)$/);
        const sched = schedules.get(n.id)?.get(1);
        if (m && sched) scheduleByOa.set(Number(m[1]), sched);
      }
      const unitSchedules = parsed.maskOrder.map((oa) => scheduleByOa.get(oa));

      deckFor(sample.deckName).sheets.push({
        // An IOE sheet spans several notes; union their tags.
        tags: normalizeTags(notes.flatMap((n) => n.tags)),
        importId: `anki-ioe:${prefix}`,
        title: header || imageName.replace(/\.[^.]+$/, ""),
        imageName,
        imageWidth: parsed.width,
        imageHeight: parsed.height,
        shapes: parsed.shapes,
        unitSchedules: unitSchedules.some(Boolean) ? unitSchedules : undefined,
      });
      stats.sheets++;
      stats.masks += parsed.shapes.length;
    }

    stats.scheduled = scheduledCount;
    stats.suspendedSkipped = suspendedSkipped;
    return {
      decks: Array.from(deckMap.values()).filter(
        (d) => d.cards.length > 0 || d.sheets.length > 0
      ),
      mediaIndex,
      zstdMedia,
      pkg,
      stats,
    };
  } finally {
    db.close();
  }
}
