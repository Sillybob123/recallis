import { useState } from "react";
import { Loader2, MessageSquare, Send, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { sendFeedback } from "../lib/firestore";

const MAX = 5000;

/**
 * Sending a note about the app.
 *
 * Where it goes is not this component's business, and deliberately so: the
 * form writes to Firestore and the scheduled sender decides the
 * destination, which it holds as a secret. Nothing in the shipped
 * JavaScript names a recipient.
 */
export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [name, setName] = useState(user?.displayName ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!user || !message.trim() || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await sendFeedback(user.uid, {
        name: name.trim(),
        email: user.email ?? "",
        message: message.trim(),
        page: window.location.pathname + window.location.search,
      });
      setSent(true);
    } catch {
      setError("That didn't send — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4">
      <div className="my-8 w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <MessageSquare size={18} className="text-indigo-600" /> Send feedback
            </h2>
            <p className="text-sm text-slate-500">
              What's broken, what's missing, what you'd change.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {sent ? (
          <div className="px-5 py-10 text-center">
            <p className="text-lg font-bold text-slate-900">Thank you — got it.</p>
            <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
              It'll be read properly. If it's a bug, it helps enormously that
              you said which page you were on — that came along with it.
            </p>
            <button
              onClick={onClose}
              className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-4 px-5 py-5">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">
                  Your name
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="So I know who to reply to"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                />
              </label>

              <label className="block">
                <span className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>Your feedback</span>
                  <span className="font-normal text-slate-400">
                    {message.length}/{MAX}
                  </span>
                </span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, MAX))}
                  rows={7}
                  autoFocus
                  placeholder="A bug, something confusing, or something you wish it did…"
                  className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm leading-relaxed outline-none focus:border-indigo-400"
                />
              </label>

              <p className="text-[11px] leading-relaxed text-slate-400">
                Sent along with it: your name, the address you signed up with,
                and the page you were on. Nothing else — not your cards, not
                your decks.
              </p>

              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || !message.trim() || !name.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Send size={15} />
                )}
                Send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
