// The screen between signing up and using the app.
//
// An account whose address hasn't been confirmed can reach no data at all —
// firestore.rules refuses it every document. That is the point: Firebase's
// signup endpoint is public, so without it "an @som.umaryland.edu account"
// means "somebody typed an @som.umaryland.edu address", and a stranger could
// register a real student's address before they got round to it.
//
// What's left is making the wall recoverable. Every account that existed
// before this check was added arrives here on its next visit, and the only
// honest thing to show them is what happened, which inbox to look in, and a
// button that sends the email again.

import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import {
  AuthLayout,
  AUTH_BUTTON_CLASS,
  AUTH_BUTTON_STYLE,
} from "./AuthLayout";
import { usePageTitle } from "../lib/pageTitle";

/** Long enough that a double-click can't send two, short enough to not annoy. */
const RESEND_COOLDOWN_MS = 30_000;

export function VerifyEmailGate() {
  usePageTitle("Confirm your email");
  const { user, logOut, sendVerification, refreshUser } = useAuth();
  const [status, setStatus] = useState<
    { kind: "idle" | "sent" | "checking" | "stale"; message?: string }
  >({ kind: "idle" });
  const [error, setError] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  // Drives the countdown on the resend button.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  // Clicking the link opens a different tab, and nothing tells this one. So
  // this one asks — on returning focus, and slowly in the background — and
  // moves on by itself the moment the answer changes.
  useEffect(() => {
    let stop = false;
    async function poll() {
      if (stop) return;
      try {
        await refreshUser();
      } catch {
        // Offline, or the token refresh failed. The button still works.
      }
    }
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    const id = setInterval(poll, 15_000);
    return () => {
      stop = true;
      window.removeEventListener("focus", onFocus);
      clearInterval(id);
    };
  }, [refreshUser]);

  const waiting = Math.max(0, cooldownUntil - now);

  async function handleResend() {
    setError("");
    try {
      await sendVerification();
      setCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
      setNow(Date.now());
      setStatus({ kind: "sent" });
    } catch {
      setError(
        "Couldn't send it just now. Wait a moment and try again — Firebase limits how often this can be requested."
      );
    }
  }

  async function handleCheck() {
    setError("");
    setStatus({ kind: "checking" });
    try {
      const ok = await refreshUser();
      // On success this component unmounts, so the only state worth setting is
      // the one that says it didn't work.
      if (!ok) setStatus({ kind: "stale" });
    } catch {
      setStatus({ kind: "idle" });
      setError("Couldn't reach Firebase. Check your connection and try again.");
    }
  }

  return (
    <AuthLayout
      title="Confirm your email"
      subtitle={
        user?.email
          ? `We sent a link to ${user.email}. Open it and your account is ready — your decks, notes and schedule are waiting behind it.`
          : "We sent you a link. Open it and your account is ready."
      }
      footer={
        <button
          type="button"
          onClick={() => void logOut()}
          className="font-semibold text-[#0b3f9e] hover:underline"
        >
          Sign out
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-slate-600">
          Recallis is open to the University of Maryland School of Medicine, so
          it has to be sure the address is really yours before it stores
          anything under it. Nothing is lost while you're here — if you had
          cards before, they're still there.
        </p>

        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={status.kind === "checking"}
          className={AUTH_BUTTON_CLASS}
          style={AUTH_BUTTON_STYLE}
        >
          {status.kind === "checking" ? "Checking…" : "I've confirmed it"}
        </button>

        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={waiting > 0}
          className="w-full rounded-lg border border-slate-300 bg-white py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
        >
          {waiting > 0
            ? `Send it again in ${Math.ceil(waiting / 1000)}s`
            : "Send the email again"}
        </button>

        {status.kind === "sent" && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2.5 text-[13px] leading-relaxed text-emerald-800">
            Sent. It usually arrives within a minute — check your spam folder
            if it doesn't.
          </p>
        )}
        {status.kind === "stale" && (
          <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-[13px] leading-relaxed text-amber-800">
            Firebase still has this address down as unconfirmed. Open the link
            in the email first, then come back — this page notices on its own.
          </p>
        )}
        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2.5 text-[13px] leading-relaxed text-rose-800">
            {error}
          </p>
        )}

        <p className="text-xs leading-relaxed text-slate-400">
          Signed up with the wrong address? Sign out and make an account with
          your school one.
        </p>
      </div>
    </AuthLayout>
  );
}
