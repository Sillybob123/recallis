// Forces the JSZip fallback and checks it produces the same result as the
// random-access reader. Two ways in: a browser with no DecompressionStream
// (older Safari), and an archive BlobZip refuses to parse.
import initSqlJs from "sql.js";
import { openAsBlob } from "node:fs";
import { statSync } from "node:fs";
import { openApkg, parseApkg, probeApkg, readMediaBytes } from "../src/lib/apkgParse";

const file =
  process.argv[2] ?? "example of decks/AnatomyApkcg.apkg";
const sizeMb = (statSync(file).size / 1e6).toFixed(0);

type Summary = {
  route: string;
  ms: number;
  peakMb: number;
  notes: number;
  cards: number;
  sheets: number;
  masks: number;
  scheduled: number;
  probeNotes: number;
  firstMediaBytes: number;
  entryCount: number;
};

async function run(route: string, prepare: () => () => void): Promise<Summary> {
  const restore = prepare();
  const t0 = performance.now();
  try {
    const pkg = await openApkg(await openAsBlob(file), () => initSqlJs());
    const entryCount = pkg.names().length;
    const probe = await probeApkg(pkg);
    const parsed = await parseApkg(pkg, { excludeSuspended: true });
    const cards = parsed.decks.flatMap((d) => d.cards);
    const sheets = parsed.decks.flatMap((d) => d.sheets);
    const media = sheets[0]
      ? await readMediaBytes(parsed, sheets[0].imageName)
      : null;
    return {
      route,
      ms: Math.round(performance.now() - t0),
      peakMb: Math.round(process.memoryUsage().rss / 1e6),
      notes: probe.totalNotes,
      cards: cards.length,
      sheets: sheets.length,
      masks: parsed.stats.masks,
      scheduled: cards.filter((c) => c.schedule?.size).length,
      probeNotes: probe.activeNotes,
      firstMediaBytes: media?.length ?? 0,
      entryCount,
    };
  } finally {
    restore();
  }
}

const results: Summary[] = [];

// 1. The fast path, as a baseline to compare against.
results.push(await run("BlobZip (default)", () => () => {}));

// 2. No DecompressionStream — what an older Safari looks like.
results.push(
  await run("JSZip (no DecompressionStream)", () => {
    const saved = globalThis.DecompressionStream;
    // @ts-expect-error deliberately removing a global
    delete globalThis.DecompressionStream;
    return () => {
      globalThis.DecompressionStream = saved;
    };
  })
);

// 3. DecompressionStream present, but the archive won't parse — the
//    nonstandard-layout branch inside openApkg's try/catch.
results.push(
  await run("JSZip (BlobZip.open throws)", () => {
    const mod = globalThis as unknown as Record<string, unknown>;
    const savedGet = Blob.prototype.slice;
    let armed = true;
    Blob.prototype.slice = function (...args: Parameters<Blob["slice"]>) {
      // Only break the very first slice: that's BlobZip reading the
      // end-of-directory record, so open() throws and openApkg falls through.
      if (armed) {
        armed = false;
        throw new Error("simulated unreadable directory");
      }
      return savedGet.apply(this, args);
    };
    void mod;
    return () => {
      Blob.prototype.slice = savedGet;
    };
  })
);

console.log(`package: ${file} (${sizeMb} MB)\n`);
for (const r of results) {
  console.log(
    `${r.route.padEnd(30)} ${String(r.ms).padStart(6)} ms  peak ${String(
      r.peakMb
    ).padStart(5)} MB  entries=${r.entryCount}`
  );
  console.log(
    `${" ".repeat(30)} notes=${r.notes} active=${r.probeNotes} cards=${r.cards} ` +
      `sheets=${r.sheets} masks=${r.masks} scheduled=${r.scheduled} media=${r.firstMediaBytes}B`
  );
}

// Every route must agree on content; only timing and memory may differ.
const [base, ...rest] = results;
const contentOf = (r: Summary) =>
  JSON.stringify({
    notes: r.notes,
    cards: r.cards,
    sheets: r.sheets,
    masks: r.masks,
    scheduled: r.scheduled,
    probeNotes: r.probeNotes,
    firstMediaBytes: r.firstMediaBytes,
    entryCount: r.entryCount,
  });
let ok = true;
for (const r of rest) {
  if (contentOf(r) !== contentOf(base)) {
    ok = false;
    console.log(`\nMISMATCH on "${r.route}":\n  ${contentOf(base)}\n  ${contentOf(r)}`);
  }
}
console.log(ok ? "\nAll routes produced identical content." : "\nRoutes disagree.");
process.exit(ok ? 0 : 1);
