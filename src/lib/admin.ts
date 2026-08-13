// Who can see how the site is doing.
//
// Identified by account id rather than by address. A uid means nothing to
// anyone outside the project and can sit in a public repository; the email
// it belongs to is nobody's business.
//
// Hiding the menu item is not the security here — anyone can read the
// JavaScript. The rule in firestore.rules is, and it names the same id: no
// other account can read the collection this page is built from, however
// they ask for it.

export const ADMIN_UIDS = ["kM4QC3YCrWfhg9SbMEN29X4Wlgu1"];

export function isAdmin(uid: string | null | undefined): boolean {
  return Boolean(uid) && ADMIN_UIDS.includes(uid as string);
}
