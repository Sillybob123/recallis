import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { FirebaseNotConfigured } from "../components/ProtectedRoute";
import { isFirebaseConfigured } from "../firebase";
import {
  AuthLayout,
  AuthField,
  AUTH_BUTTON_CLASS,
  AUTH_BUTTON_STYLE,
} from "../components/AuthLayout";

export function Login() {
  const { logIn, resetPassword } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isFirebaseConfigured) return <FirebaseNotConfigured />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await logIn(email, password);
      navigate("/");
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!email) {
      setError("Enter your email above first, then click “Forgot password”.");
      return;
    }
    setError("");
    try {
      await resetPassword(email);
      setInfo("Password reset email sent — check your inbox.");
    } catch (err) {
      setError(friendlyAuthError(err));
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to pick up where you left off."
      footer={
        <>
          New to Recallis?{" "}
          <Link
            to="/signup"
            className="font-semibold text-[#0b3f9e] hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label="Email"
          type="email"
          required
          autoFocus
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <div>
          <AuthField
            label="Password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            onClick={handleReset}
            className="mt-1.5 text-xs text-slate-500 transition hover:text-[#0b3f9e]"
          >
            Forgot password?
          </button>
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {info && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {info}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className={AUTH_BUTTON_CLASS}
          style={AUTH_BUTTON_STYLE}
        >
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </AuthLayout>
  );
}

export function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  const map: Record<string, string> = {
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/email-already-in-use": "An account already exists with that email.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/too-many-requests": "Too many attempts — please wait and try again.",
    "auth/network-request-failed": "Network problem — check your connection.",
    "auth/unauthorized-domain":
      "This web address isn't authorized in Firebase yet (Authentication → Settings → Authorized domains).",
  };
  return map[code] || "Something went wrong. Please try again.";
}
