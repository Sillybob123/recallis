import { useEffect, useState } from "react";
import { Check, Gamepad2, Keyboard, RotateCcw, X } from "lucide-react";
import {
  actionForButton,
  bindButton,
  detectFromButton,
  detectFromKey,
  type Detection,
  bindKey,
  buttonLabel,
  clearAction,
  keyLabel,
  REMOTE_ACTIONS,
  REMOTE_PRESETS,
  UNREACHABLE_KEYS,
  type RemoteAction,
  type RemoteMapping,
} from "../lib/remote";
import { useGamepadCapture } from "../lib/useRemote";
import { saveRemoteMapping } from "../lib/settings";

/**
 * Teaching the app what your remote sends.
 *
 * The presets cover the two remotes most people own, but a remote you can't
 * configure is a remote that doesn't work — so the real answer is "press
 * the button and we'll learn it". Capture takes whatever arrives, key or
 * gamepad button, which is the only approach that survives the next remote
 * nobody has heard of yet.
 */
export function RemoteSetup({
  mapping,
  onChange,
  onClose,
  connect = false,
}: {
  mapping: RemoteMapping;
  onChange: (m: RemoteMapping) => void;
  onClose: () => void;
  /** opens on the pairing walkthrough rather than the binding table */
  connect?: boolean;
}) {
  const [draft, setDraft] = useState<RemoteMapping>(mapping);
  const [capturing, setCapturing] = useState<RemoteAction | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [padId, setPadId] = useState<string | null>(null);
  const [listening, setListening] = useState(connect);
  const [found, setFound] = useState<Detection | null>(null);

  // While capturing, every key is swallowed — otherwise binding Space would
  // also press whatever button happens to have focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setCapturing(null);
        return;
      }
      if (listening && !capturing) {
        // The connect walkthrough: whatever arrives identifies the remote.
        const detected = detectFromKey(e.key);
        setHeard(keyLabel(e.key.toLowerCase()));
        if (detected) {
          e.preventDefault();
          setFound(detected);
          setListening(false);
          const preset = REMOTE_PRESETS.find((p) => p.id === detected.presetId);
          if (preset) setDraft(preset.mapping);
        }
        return;
      }
      if (!capturing) return;
      e.preventDefault();
      e.stopPropagation();
      setDraft((d) => bindKey(d, capturing, e.key));
      setHeard(keyLabel(e.key.toLowerCase()));
      setCapturing(null);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, listening]);

  useGamepadCapture(true, (index, id) => {
    setPadId(id);
    if (listening && !capturing) {
      setFound(detectFromButton(id));
      setListening(false);
      setDraft((d) => ({ ...d, gamepad: true }));
      setHeard(buttonLabel(index));
      return;
    }
    if (!capturing) {
      // Not binding: still show what arrived, so a remote that seems dead
      // can be told apart from one that's simply mapped elsewhere.
      const existing = actionForButton(draft, index);
      setHeard(
        `${buttonLabel(index)}${existing ? ` → ${labelFor(existing)}` : " (not bound)"}`
      );
      return;
    }
    setDraft((d) => bindButton(d, capturing, index));
    setHeard(buttonLabel(index));
    setCapturing(null);
  });

  function save() {
    saveRemoteMapping(draft);
    onChange(draft);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div className="my-4 w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Study remote</h2>
            <p className="text-sm text-slate-500">
              Any Bluetooth remote that sends key presses works, and so does
              anything your browser sees as a controller.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          {/* connecting */}
          {(listening || found) && (
            <section
              className={`rounded-xl border p-4 ${
                found ? "border-emerald-200 bg-emerald-50" : "border-indigo-200 bg-indigo-50"
              }`}
            >
              {found ? (
                <>
                  <p className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                    <Check size={16} /> {found.name} — connected
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-emerald-700">
                    {found.why} Its buttons are set up below; save to keep
                    them, or change any of them first.
                  </p>
                  <button
                    onClick={() => {
                      setFound(null);
                      setListening(true);
                    }}
                    className="mt-2 text-xs font-semibold text-emerald-800 underline"
                  >
                    Not right — try again
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-indigo-900">
                    Press any button on your remote
                  </p>
                  <ol className="mt-2 space-y-1 text-xs leading-relaxed text-indigo-800">
                    <li>
                      <b>1.</b> Pair it in your device's Bluetooth settings
                      first — this page can't do that part, no website can.
                    </li>
                    <li>
                      <b>2.</b> An 8BitDo needs to be in keyboard mode for
                      phones and tablets: hold <b>R + Start</b> for five
                      seconds. On a laptop its normal mode works too.
                    </li>
                    <li>
                      <b>3.</b> Press a button now. I'll work out which remote
                      it is and set the buttons up for you.
                    </li>
                  </ol>
                  {heard && (
                    <p className="mt-2 text-xs text-indigo-700">
                      Received <b>{heard}</b> — but that isn't a key I
                      recognise as a remote. Save anyway and bind it by hand
                      below, or press a different button.
                    </p>
                  )}
                </>
              )}
            </section>
          )}

          {/* presets */}
          <section>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
              Start from
            </h3>
            <div className="grid gap-2 sm:grid-cols-3">
              {REMOTE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setDraft(p.mapping)}
                  className="rounded-xl border border-slate-200 p-2.5 text-left transition hover:border-indigo-300 hover:bg-indigo-50"
                >
                  <span className="block text-sm font-semibold text-slate-800">
                    {p.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
                    {p.note}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* live monitor */}
          <section className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="flex items-center gap-1.5 font-semibold text-slate-700">
                <Gamepad2 size={15} className={padId ? "text-emerald-600" : "text-slate-300"} />
                {padId ? "Controller connected" : "No controller detected"}
              </span>
              {heard && (
                <span className="text-slate-500">
                  last received: <b className="text-slate-800">{heard}</b>
                </span>
              )}
            </div>
            {!padId && (
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                A controller stays invisible to the browser until you press
                one of its buttons — press any button now and it will appear.
              </p>
            )}
          </section>

          {/* bindings */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">
              <Keyboard size={13} /> What each button does
            </h3>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {REMOTE_ACTIONS.map((action) => {
                const keys = draft.keys[action.id] ?? [];
                const buttons = draft.buttons[action.id] ?? [];
                const isCapturing = capturing === action.id;
                return (
                  <li key={action.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800">
                        {action.label}
                      </p>
                      {action.hint && (
                        <p className="text-[11px] leading-relaxed text-slate-400">
                          {action.hint}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {keys.map((k) => (
                        <span
                          key={`k-${k}`}
                          className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600"
                        >
                          {keyLabel(k)}
                        </span>
                      ))}
                      {buttons.map((b) => (
                        <span
                          key={`b-${b}`}
                          className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700"
                        >
                          {buttonLabel(b)}
                        </span>
                      ))}
                      {keys.length === 0 && buttons.length === 0 && (
                        <span className="text-[11px] text-slate-300">nothing</span>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setHeard(null);
                        setCapturing(isCapturing ? null : action.id);
                      }}
                      className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                        isCapturing
                          ? "animate-pulse bg-indigo-600 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {isCapturing ? "Press it…" : "Add"}
                    </button>
                    <button
                      onClick={() => setDraft((d) => clearAction(d, action.id))}
                      title="Clear"
                      className="shrink-0 text-slate-300 hover:text-red-500"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={draft.gamepad}
              onChange={(e) => setDraft({ ...draft, gamepad: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              Read connected controllers
              <span className="block text-[11px] leading-relaxed text-slate-400">
                Lets an 8BitDo or similar work in its normal mode — no
                Karabiner or Joy2Key needed, unlike the desktop Anki setup.
              </span>
            </span>
          </label>

          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            <b>One thing no website can do:</b> {UNREACHABLE_KEYS}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            <Check size={15} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

function labelFor(action: RemoteAction): string {
  return REMOTE_ACTIONS.find((a) => a.id === action)?.label ?? action;
}
