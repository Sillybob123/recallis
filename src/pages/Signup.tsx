import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { FirebaseNotConfigured } from "../components/ProtectedRoute";
import { isFirebaseConfigured } from "../firebase";
import { friendlyAuthError } from "./Login";
import {
  ALLOWED_EMAIL_DOMAIN,
  ALLOWED_EMAIL_EXAMPLE,
  signupDomainError,
} from "../lib/access";
import {
  AuthLayout,
  AuthField,
  AUTH_BUTTON_CLASS,
  AUTH_BUTTON_STYLE,
} from "../components/AuthLayout";

export function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isFirebaseConfigured) return <FirebaseNotConfigured />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const domainProblem = signupDomainError(email);
    if (domainProblem) {
      setError(domainProblem);
      return;
    }
    setBusy(true);
    try {
      await signUp(email, password, name);
      navigate("/");
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle={`Open to the University of Maryland School of Medicine — sign up with your ${ALLOWED_EMAIL_DOMAIN} address.`}
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-[#0b3f9e] hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label="Name"
          hint="optional"
          type="text"
          autoFocus
          autoComplete="name"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <AuthField
          label="School email"
          type="email"
          required
          autoComplete="email"
          placeholder={ALLOWED_EMAIL_EXAMPLE}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <AuthField
          label="Password"
          hint="min. 6 characters"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className={AUTH_BUTTON_CLASS}
          style={AUTH_BUTTON_STYLE}
        >
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
    </AuthLayout>
  );
}
