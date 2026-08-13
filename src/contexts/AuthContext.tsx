import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  type User,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
  sendEmailVerification,
} from "firebase/auth";
import { auth, isFirebaseConfigured } from "../firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  logIn: (email: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  /**
   * Whether Firebase has confirmed the account's address.
   *
   * Kept as state rather than read off `user.emailVerified` because reload()
   * mutates the User object in place: the value on it changes without the
   * reference changing, so React would never re-render.
   */
  emailVerified: boolean;
  /** Send (or re-send) the address-confirmation email. */
  sendVerification: () => Promise<void>;
  /**
   * Re-read the account from Firebase and republish it.
   *
   * Verifying happens in another tab, and nothing tells this one. Without a
   * way to ask, someone who has just clicked the link is still looking at the
   * "check your inbox" screen with no way past it.
   */
  refreshUser: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        import("../lib/settings")
          .then(({ initSettingsSync }) => initSettingsSync(u.uid))
          .catch(() => {});
        // A line in the register: who is here, and when. Throttled inside,
        // and failure is ignored — it must never stand between someone and
        // their cards.
        import("../lib/firestore")
          .then(({ touchPresence }) => touchPresence(u))
          .catch(() => {});
      }
      setUser(u);
      setEmailVerified(Boolean(u?.emailVerified));
      setLoading(false);
    });
    return unsub;
  }, []);

  async function signUp(email: string, password: string, name: string) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (name) {
      await updateProfile(cred.user, { displayName: name });
    }
    // The account exists but reaches no data until the address is confirmed,
    // so this email is the rest of signing up rather than an afterthought.
    // A failure here is not fatal — the gate screen offers to send it again.
    await sendEmailVerification(cred.user).catch(() => {});
  }

  async function sendVerification() {
    if (!auth.currentUser) throw new Error("Nobody is signed in.");
    await sendEmailVerification(auth.currentUser);
  }

  async function refreshUser(): Promise<boolean> {
    if (!auth.currentUser) return false;
    await auth.currentUser.reload();
    // reload() mutates the User in place, so there is no new reference for
    // React to notice — which is why the flag is state of its own rather than
    // something read off the user object. getIdToken(true) then refreshes the
    // claims the rules read, and that is what actually lets the next
    // Firestore call through.
    await auth.currentUser.getIdToken(true);
    const ok = auth.currentUser.emailVerified;
    setEmailVerified(ok);
    return ok;
  }

  async function logIn(email: string, password: string) {
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function logOut() {
    await signOut(auth);
  }

  async function resetPassword(email: string) {
    await sendPasswordResetEmail(auth, email);
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        emailVerified,
        loading,
        signUp,
        logIn,
        logOut,
        resetPassword,
        sendVerification,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
