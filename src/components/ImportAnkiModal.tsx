import { useRef, useState } from "react";
import { FileUp, X } from "lucide-react";
import { importAnkiText, ankiDeckToName, type AnkiImportResult } from "../lib/ankiImport";
import { createCardsBulk, createDeck } from "../lib/firestore";
import { parseApkgInBrowser, importParsedApkg, type ApkgImportProgress } from "../lib/apkgImport";
import type { ParsedApkg } from "../lib/apkgParse";

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#ec4899"];

export function ImportAnkiModal({
  uid,
  onClose,
}: {
  uid: string;
  onClose: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [txtResult, setTxtResult] = useState<AnkiImportResult | null>(null);
  const [pkgResult, setPkgResult] = useState<ParsedApkg | null>(null);
  const [parseError, setParseError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [split, setSplit] = useState(true);
  const [importSchedule, setImportSchedule] = useState(true);
  const [singleName, setSingleName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ApkgImportProgress | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  async function handleFile(f: File) {
    setFileName(f.name);
    setParseError("");
    setTxtResult(null);
    setPkgResult(null);
    setParsing(true);
    try {
      const isPackage = /\.(apkg|colpkg)$/i.test(f.name);
      if (isPackage) {
        if (f.size > 400 * 1024 * 1024) {
          setParseError(
            "That package is very large (probably a whole-collection .colpkg). The browser may run out of memory unpacking it. In Anki, use File → Export → Anki Deck Package (.apkg) for just the deck you want, with 'Include media' checked — it'll be much smaller."
          );
          setParsing(false);
          return;
        }
        const parsed = await parseApkgInBrowser(f);
        if (parsed.decks.length === 0) {
          setParseError("No importable cards or occlusion sheets found in this package.");
          setParsing(false);
          return;
        }
        setPkgResult(parsed);
      } else {
        const text = await f.text();
        const parsed = importAnkiText(text);
        if (parsed.totalBasic + parsed.totalCloze === 0) {
          setParseError(
            parsed.skippedImageOcclusion > 0
              ? "This .txt only contains Image Occlusion notes, and a .txt export doesn't carry their image files. Export the deck as a .apkg instead (File → Export → Anki Deck Package, 'Include media' checked) and import that — images and masks come across automatically."
              : "No importable cards found in this file. Is it an Anki export?"
          );
          setParsing(false);
          return;
        }
        setTxtResult(parsed);
      }
      if (!singleName) setSingleName(f.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      setParseError("Could not read that file: " + (err as Error).message);
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    setBusy(true);
    setParseError("");
    try {
      if (pkgResult) {
        abortRef.current = new AbortController();
        const outcome = await importParsedApkg(uid, pkgResult, {
          split,
          singleDeckName: singleName.trim() || "Imported deck",
          importSchedule,
          onProgress: setProgress,
          signal: abortRef.current.signal,
        });
        setWarnings(outcome.warnings);
        const parts = [
          `Added ${outcome.cardsCreated} card${outcome.cardsCreated === 1 ? "" : "s"}` +
            (outcome.sheetsCreated > 0
              ? ` and ${outcome.sheetsCreated} occlusion sheet${outcome.sheetsCreated === 1 ? "" : "s"} (${outcome.masksCreated} masks)`
              : "") +
            (outcome.decksCreated > 0
              ? `, creating ${outcome.decksCreated} new deck${outcome.decksCreated === 1 ? "" : "s"}.`
              : "."),
        ];
        if (outcome.tagsUpdated > 0) {
          parts.push(
            `Tags updated on ${outcome.tagsUpdated} existing note${outcome.tagsUpdated === 1 ? "" : "s"}.`
          );
        }
        if (outcome.duplicatesSkipped > 0) {
          parts.push(
            `Skipped ${outcome.duplicatesSkipped} note${outcome.duplicatesSkipped === 1 ? "" : "s"} you already had — no duplicates were created.`
          );
        }
        if (outcome.schedulesRestored > 0) {
          parts.push(
            `Review schedules updated for ${outcome.schedulesRestored} card${outcome.schedulesRestored === 1 ? "" : "s"}.`
          );
        }
        setDone(parts.join(" "));
      } else if (txtResult) {
        if (split && txtResult.groups.some((g) => g.ankiDeck)) {
          let colorIdx = 0;
          for (const group of txtResult.groups) {
            const deckId = await createDeck(
              uid,
              ankiDeckToName(group.ankiDeck),
              "Imported from Anki",
              COLORS[colorIdx++ % COLORS.length]
            );
            await createCardsBulk(
              uid,
              deckId,
              group.cards.map((c) => c.data),
              undefined,
              group.cards.map((c) => c.tags)
            );
          }
        } else {
          const deckId = await createDeck(
            uid,
            singleName.trim() || "Imported deck",
            "Imported from Anki",
            COLORS[0]
          );
          const all = txtResult.groups.flatMap((g) => g.cards);
          await createCardsBulk(
            uid,
            deckId,
            all.map((c) => c.data),
            undefined,
            all.map((c) => c.tags)
          );
        }
        setDone(
          `Imported ${txtResult.totalBasic + txtResult.totalCloze} cards (${txtResult.totalCloze} cloze, ${txtResult.totalBasic} basic).`
        );
      }
    } catch (err) {
      const message = (err as Error).message;
      setParseError(
        /cancel/i.test(message)
          ? "Import cancelled. Anything already imported was kept — you can delete those decks or re-import to finish."
          : "Import failed: " + message
      );
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  }

  const pkgStats = pkgResult
    ? {
        cards: pkgResult.stats.cloze + pkgResult.stats.basic,
        deckNames: pkgResult.decks.map((d) => d.name),
      }
    : null;
  const txtDeckNames = txtResult
    ? Array.from(new Set(txtResult.groups.map((g) => g.ankiDeck).filter(Boolean)))
    : [];
  const multiDeck =
    (pkgStats?.deckNames.length ?? 0) > 1 || txtDeckNames.length > 1;
  const ready = Boolean(pkgResult || txtResult);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Import from Anki</h2>
            <p className="text-xs text-slate-500">
              Cards, images, occlusion masks, and review history come across.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">

        {done ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="mb-2 text-sm font-semibold text-emerald-700">{done}</p>
            {warnings.length > 0 && (
              <details className="mb-2 text-xs text-amber-700">
                <summary className="cursor-pointer font-medium">
                  {warnings.length} warning{warnings.length === 1 ? "" : "s"}
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {warnings.slice(0, 20).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            <button
              onClick={onClose}
              className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <label className="mb-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 py-10 text-slate-500 transition hover:border-indigo-400 hover:bg-indigo-50">
              <FileUp size={22} />
              <span className="text-sm font-semibold text-slate-700">
                {parsing ? "Reading…" : fileName || "Choose an Anki export"}
              </span>
              <span className="max-w-md px-4 text-center text-xs leading-relaxed">
                Best: a <b>.apkg</b> deck package (File → Export → Anki Deck Package,
                "Include media" checked) — brings images and occlusion masks.
                Also accepts .colpkg and plain .txt exports.
              </span>
              <input
                type="file"
                accept=".txt,.tsv,.csv,.apkg,.colpkg,text/plain,application/zip"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </label>

            {parseError && (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {parseError}
              </p>
            )}

            {pkgResult && pkgStats && (
              <div className="mb-4">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                  Package contents
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Tile
                    value={pkgResult.stats.cloze + pkgResult.stats.basic}
                    label="cards"
                    hint={`${pkgResult.stats.cloze} cloze · ${pkgResult.stats.basic} basic`}
                  />
                  <Tile
                    value={pkgResult.stats.sheets}
                    label="image sheets"
                    hint={`${pkgResult.stats.masks} masks`}
                  />
                  <Tile
                    value={pkgResult.stats.scheduled}
                    label="with history"
                    hint={pkgResult.stats.scheduled > 0 ? "schedules kept" : "all new"}
                    accent={pkgResult.stats.scheduled > 0}
                  />
                  <Tile
                    value={pkgResult.decks.length}
                    label="decks"
                    hint={pkgResult.stats.skippedNotes > 0 ? `${pkgResult.stats.skippedNotes} skipped` : "ready"}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Occlusion notes become native, editable sheets with their mask
                  groups intact, and every image uploads to your own storage.
                </p>
              </div>
            )}

            {txtResult && (
              <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <p className="font-semibold">
                  {txtResult.totalBasic + txtResult.totalCloze} cards ready to import
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                  <li>{txtResult.totalCloze} cloze cards</li>
                  <li>{txtResult.totalBasic} basic front/back cards</li>
                  {txtResult.skippedImageOcclusion > 0 && (
                    <li className="text-amber-600">
                      {txtResult.skippedImageOcclusion} image-occlusion notes skipped — re-export
                      as .apkg with media to bring those across automatically.
                    </li>
                  )}
                </ul>
              </div>
            )}

            {ready && (
              <div className="space-y-3">
                {(pkgResult?.stats.scheduled ?? 0) > 0 && (
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={importSchedule}
                      onChange={(e) => setImportSchedule(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Keep Anki's review schedule
                      <span className="mt-0.5 block text-xs text-slate-400">
                        Due dates, intervals, and lapses carry over, so mature
                        cards stay mature instead of restarting as new. Uncheck
                        to import everything as brand-new cards.
                      </span>
                    </span>
                  </label>
                )}
                {multiDeck && (
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={split}
                      onChange={(e) => setSplit(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Split into decks matching the Anki deck names
                      <span className="mt-0.5 block text-xs text-slate-400">
                        {(pkgStats?.deckNames ?? txtDeckNames.map(ankiDeckToName))
                          .slice(0, 3)
                          .join(", ")}
                        {(pkgStats?.deckNames ?? txtDeckNames).length > 3 ? "…" : ""}
                      </span>
                    </span>
                  </label>
                )}
                {(!split || !multiDeck) && (
                  <input
                    value={singleName}
                    onChange={(e) => setSingleName(e.target.value)}
                    placeholder="Name for the new deck"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />
                )}

                {busy && progress && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-1.5 flex justify-between text-xs text-slate-600">
                      <span className="truncate pr-2">{progress.stage}</span>
                      <span className="shrink-0 font-medium">
                        {progress.done}/{progress.total}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-indigo-600 transition-all"
                        style={{
                          width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">
                      Keep this tab open. Slow uploads are retried automatically,
                      and anything that fails is reported at the end.
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        </div>

        {!done && ready && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
            <button
              onClick={() => {
                if (busy) abortRef.current?.abort();
                else onClose();
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
            >
              {busy ? "Cancel import" : "Cancel"}
            </button>
            <button
              onClick={handleImport}
              disabled={busy}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? "Importing…" : "Import"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({
  value,
  label,
  hint,
  accent,
}: {
  value: number;
  label: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        accent ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"
      }`}
    >
      <p
        className={`text-xl font-bold ${accent ? "text-emerald-700" : "text-slate-800"}`}
      >
        {value}
      </p>
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <p className="truncate text-[10px] text-slate-400">{hint}</p>
    </div>
  );
}
