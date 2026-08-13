import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isFirebaseConfigured } from "../firebase";
import { needsEmailVerification } from "../lib/access";
import { VerifyEmailGate } from "./VerifyEmailGate";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, emailVerified, loading } = useAuth();

  if (!isFirebaseConfigured) {
    return <FirebaseNotConfigured />;
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Signed in but the address isn't confirmed, so the rules will refuse every
  // read behind this point. Showing the reason beats letting the app load and
  // fail one empty panel at a time.
  //
  // One gate here rather than a check per page: a route added later is covered
  // by being protected, which is the property worth having.
  if (needsEmailVerification({ uid: user.uid, emailVerified })) {
    return <VerifyEmailGate />;
  }

  return <>{children}</>;
}

export function FirebaseNotConfigured() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-8 text-slate-800 shadow-sm">
        <h1 className="mb-2 text-xl font-bold text-amber-800">
          Firebase isn't configured yet
        </h1>
        <p className="mb-3 text-sm leading-relaxed">
          This app needs a Firebase project to store your decks, cards, and
          images. Create a <code className="rounded bg-amber-100 px-1">.env</code>{" "}
          file in the project root (copy <code className="rounded bg-amber-100 px-1">.env.example</code>)
          and fill in your Firebase web app config values.
        </p>
        <p className="text-sm leading-relaxed">
          Full step-by-step setup instructions are in{" "}
          <code className="rounded bg-amber-100 px-1">README.md</code>.
        </p>
      </div>
    </div>
  );
}
