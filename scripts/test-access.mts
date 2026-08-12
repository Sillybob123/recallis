// Who can sign up. A domain check is the sort of thing that looks trivial
// and then lets in "som.umaryland.edu.attacker.com", so the near-misses are
// most of what's tested here.
import {
  ALLOWED_EMAIL_DOMAIN,
  isAllowedEmail,
  signupDomainError,
} from "../src/lib/access";
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

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
