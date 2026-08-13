// Who can sign up. A domain check is the sort of thing that looks trivial
// and then lets in "som.umaryland.edu.attacker.com", so the near-misses are
// most of what's tested here.
import {
  ALLOWED_EMAIL_DOMAIN,
  GRANDFATHERED_UIDS,
  isAllowedEmail,
  signupDomainError,
} from "../src/lib/access";
import { headerSafe } from "../src/lib/emailTemplate";
import { readFileSync } from "node:fs";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("the school domain:");
{
  check("a plain school address is fine", isAllowedEmail("yben-dor@som.umaryland.edu"));
  check("case doesn't matter", isAllowedEmail("YBen-Dor@SOM.UMaryland.EDU"));
  check("surrounding space doesn't either", isAllowedEmail("  a@som.umaryland.edu  "));
  check("plus addressing still works", isAllowedEmail("a+anki@som.umaryland.edu"));

  check("a personal address is not", !isAllowedEmail("someone@gmail.com"));
  check(
    "the university's other domains are not",
    !isAllowedEmail("someone@umaryland.edu"),
    "only the school of medicine"
  );
  check(
    "a subdomain of it is not",
    !isAllowedEmail("a@mail.som.umaryland.edu"),
    "exact domain only"
  );
  check(
    "and neither is a lookalike that merely ends the same way",
    !isAllowedEmail("a@evilsom.umaryland.edu")
  );
  check(
    "nor one that continues past it",
    !isAllowedEmail("a@som.umaryland.edu.example.com"),
    "the classic way a suffix check gets fooled"
  );
  check(
    "an address with two @ takes the last domain",
    !isAllowedEmail("a@som.umaryland.edu@gmail.com")
  );
  check("no @ at all is not an address", !isAllowedEmail("som.umaryland.edu"));
  check("an empty string isn't either", !isAllowedEmail(""));
  check("nor a bare @", !isAllowedEmail("@som.umaryland.edu"));
}

console.log("\nwhat the form says:");
{
  check("nothing typed yet, nothing to complain about", signupDomainError("") === null);
  check("a good address passes silently", signupDomainError("a@som.umaryland.edu") === null);
  const err = signupDomainError("a@gmail.com") ?? "";
  check("a bad one explains itself", err.length > 0);
  check("and names the domain", err.includes(ALLOWED_EMAIL_DOMAIN), err);
}

// The client check is a courtesy; the rules are the enforcement. If they
// ever stop agreeing, the courtesy is all that's left.
console.log("\nthe rules enforce the same thing:");
{
  const rules = readFileSync("firestore.rules", "utf8");
  check(
    "the domain appears in the rules",
    rules.includes("som[.]umaryland[.]edu"),
    "escaped for the matcher"
  );
  check("matched case-insensitively", rules.includes("(?i)"));
  check(
    "every user path requires it",
    (rules.match(/allowed\(\)/g) ?? []).length >= 3,
    "user data, reminder settings and feedback"
  );
  check(
    "feedback can be written but never read back",
    rules.includes("allow read, update, delete: if false"),
    "not even by the person who wrote it"
  );
  check(
    "and the recipient's address is nowhere in the repository",
    !rules.includes("@gmail.com"),
    "it lives only in a Worker secret"
  );
}

// Confirmation mail to the school's domain is filtered or dropped often
// enough that requiring it locked out real students, so it was removed on
// purpose. These cases pin that decision in place: someone re-adding the
// check — or the send that goes with it — should have to change a test that
// says why, rather than quietly breaking signups again.
console.log("\nno address confirmation, deliberately:");
{
  const rules = readFileSync("firestore.rules", "utf8");
  const storage = readFileSync("storage.rules", "utf8");
  const authCtx = readFileSync("src/contexts/AuthContext.tsx", "utf8");

  // Both files discuss email_verified at length in comments, explaining why it
  // is not there — so the check has to read the rules, not the prose.
  const code = (src: string) =>
    src
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");

  check(
    "firestore does not require a confirmed address",
    !code(rules).includes("email_verified"),
    "school mail blocks it, and the lockout was worse than the risk"
  );
  check("storage does not either", !code(storage).includes("email_verified"));
  check(
    "though both still explain the omission",
    rules.includes("email_verified") && storage.includes("email_verified"),
    "an absent check with no reason beside it reads as a mistake"
  );
  check(
    "and signing up sends no confirmation email",
    !authCtx.includes("sendEmailVerification"),
    "an email nobody receives is a dead end, not a gate"
  );
  check(
    "the trade-off is written down where the rule is",
    rules.includes("App Check") && rules.includes("blocking function"),
    "so the next person reads why before undoing it"
  );
  // The domain gate is now the whole of the restriction, so it had better be
  // exactly right.
  check(
    "the domain pattern is anchored at both ends",
    rules.includes("^[^@]+@som[.]umaryland[.]edu$"),
    "an unanchored match is how a suffix check gets fooled"
  );
  check(
    "no @ is allowed inside the local part",
    rules.includes("[^@]+@"),
    "so a@som.umaryland.edu@evil.com can't match"
  );
  check(
    "storage and firestore agree on the pattern",
    storage.includes("^[^@]+@som[.]umaryland[.]edu$"),
    "two files, one rule — they drift or they hold together"
  );

  // Neither grandfathered account is at the school, so the domain check would
  // refuse them and they'd be locked out of their own project.
  for (const uid of GRANDFATHERED_UIDS) {
    check(
      `the rules still name ${uid.slice(0, 8)}…`,
      rules.includes(uid) && storage.includes(uid),
      "an owner locked out of their own project is a real outage"
    );
  }
}

// Field bounds. The client slices these before writing, which is worth
// nothing: the REST API takes whatever it's given, and the sender turns some
// of these straight into an email to the owner.
console.log("\nwhat a document is allowed to contain:");
{
  const rules = readFileSync("firestore.rules", "utf8");
  check(
    "feedback is pinned to a known set of fields",
    rules.includes("hasOnly(") && rules.includes("hasAll("),
    "otherwise it's a megabyte of anything under your uid"
  );
  check("the feedback name is bounded", rules.includes("name.size() <= 120"));
  check("the page is bounded", rules.includes("page.size() <= 300"));
  check(
    "a new feedback note can't arrive pre-marked as sent",
    rules.includes("sent == false"),
    "or it would never be delivered"
  );
  check(
    "the signups email is the one the token vouches for",
    rules.includes("request.resource.data.email == request.auth.token.email"),
    "so the stats page isn't showing a self-reported address"
  );
  check(
    "the reminder list is bounded",
    rules.includes("custom.size() <= 100"),
    "every entry that comes due is an email the sender has to post"
  );
}

// A subject is a mail header, and headers are newline-delimited.
console.log("\nnothing user-typed can forge a mail header:");
{
  check(
    "a newline can't start a header of its own",
    !headerSafe("Real Name\r\nBcc: someone@example.com").includes("\n")
  );
  check(
    "nor a bare line feed",
    !headerSafe("a\nBcc: x@y.com").includes("\n")
  );
  check(
    "the injected text is flattened, not silently kept",
    headerSafe("Real Name\r\nBcc: x@y.com") === "Real Name Bcc: x@y.com"
  );
  check("a tab goes too", headerSafe("a\tb") === "a b");
  check(
    "an ordinary hyphenated name survives intact",
    headerSafe("Yair Ben-Dor") === "Yair Ben-Dor",
    "the stripping must not reach normal punctuation"
  );
  check(
    "an accented name survives too",
    headerSafe("Zoë Šimek") === "Zoë Šimek"
  );
  check("runs of space collapse", headerSafe("a     b") === "a b");
  check("and it is clipped", headerSafe("x".repeat(500)).length <= 200);
  check("with an ellipsis to show it was", headerSafe("x".repeat(500)).endsWith("…"));
  check("an empty string stays empty", headerSafe("") === "");
}

// School mail is slow and filters hard. Since there is no confirmation email
// any more, the reset link is the only mail the app sends to a student — so
// the one place it's mentioned had better set the right expectation.
console.log("\nwhat the reset message tells you:");
{
  const login = readFileSync("src/pages/Login.tsx", "utf8");
  check(
    "it warns the mail may be slow",
    /couple of minutes/i.test(login),
    "otherwise people click it four times and give up"
  );
  check("it names the spam folder", /spam/i.test(login));
  check(
    "and it still says the mail was sent",
    /reset email sent/i.test(login)
  );
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
