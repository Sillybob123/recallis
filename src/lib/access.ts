// Who is allowed to sign up.
//
// Recallis is being released to one class first, so an account has to come
// from the school's domain. The check here is the polite half — it stops
// someone wasting their time on a form that was never going to work. The
// enforcement that matters is in firestore.rules, which refuses to hand any
// data to an account outside the domain no matter how the account was made.
//
// Worth being clear about the gap: Firebase Authentication itself will still
// create an account for any address, because blocking that needs a paid
// Identity Platform function. Such an account simply cannot read or write
// anything.

export const ALLOWED_EMAIL_DOMAIN = "som.umaryland.edu";

/**
 * The accounts that predate the domain restriction, mirroring the same list in
 * firestore.rules and storage.rules.
 *
 * Opaque account ids, not addresses — a uid means nothing outside the project.
 * Neither account is at the school, so the domain check would refuse them.
 */
export const GRANDFATHERED_UIDS = [
  "9JDZJEF9YhNuxIBN3Vwtbu2oqut2",
  "kM4QC3YCrWfhg9SbMEN29X4Wlgu1",
];

// There is deliberately no email-confirmation check here or in the rules.
// Mail to som.umaryland.edu is filtered or dropped often enough that requiring
// it locked out real students, so the domain gate proves the address was typed
// rather than owned. firestore.rules records the trade-off in full.

/** The address form used in messages, so the rule reads the same everywhere. */
export const ALLOWED_EMAIL_EXAMPLE = `you@${ALLOWED_EMAIL_DOMAIN}`;

export function isAllowedEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  // Only the last @ counts: an address is the part after the final one.
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = trimmed.slice(at + 1);
  // Exact domain only. A subdomain of it, or a lookalike ending in the same
  // letters, is somebody else.
  return domain === ALLOWED_EMAIL_DOMAIN;
}

export function signupDomainError(email: string): string | null {
  if (!email.trim()) return null;
  if (isAllowedEmail(email)) return null;
  return `Recallis is open to the University of Maryland School of Medicine for now. Sign up with your ${ALLOWED_EMAIL_DOMAIN} address.`;
}
