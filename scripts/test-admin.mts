// The creator stats page shows every account's name and address, so the
// question worth testing is not whether the menu item is hidden — anyone can
// read the JavaScript — but whether the data is closed to everyone else.
import { readFileSync } from "node:fs";
import { ADMIN_UIDS, isAdmin } from "../src/lib/admin";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const rules = readFileSync("firestore.rules", "utf8");

console.log("who counts as the owner:");
{
  check("exactly one account does", ADMIN_UIDS.length === 1, `${ADMIN_UIDS.length}`);
  check("and it is recognised", isAdmin(ADMIN_UIDS[0]));
  check("another signed-in account is not", !isAdmin("someoneElse"));
  check("nor is a missing id", !isAdmin(null) && !isAdmin(undefined) && !isAdmin(""));
  check(
    "the id is an id, not an address",
    !ADMIN_UIDS[0].includes("@"),
    "a public repository shouldn't name anyone"
  );
}

console.log("\nthe rules, which are what actually protect it:");
{
  check(
    "the sign-up register has its own rule",
    /match \/signups\/\{uid\}/.test(rules)
  );
  const block = rules.slice(
    rules.indexOf("match /signups/{uid}"),
    rules.indexOf("}", rules.indexOf("allow delete: if false", rules.indexOf("match /signups/{uid}")))
  );
  check(
    "reading it needs to be its owner or the admin",
    /allow read:[\s\S]*request\.auth\.uid == uid[\s\S]*isAdmin\(\)/.test(block),
    block.split("\n")[1]?.trim()
  );
  check(
    "the client and the rules name the same account",
    rules.includes(ADMIN_UIDS[0]),
    "otherwise the menu shows a page that then refuses to load"
  );
  check(
    "nobody can write someone else's record",
    /allow create, update:[\s\S]*request\.auth\.uid == uid/.test(block)
  );
  check(
    "and nobody can delete one",
    /allow delete: if false/.test(block),
    "a record of who joined shouldn't be erasable from a browser"
  );
}

console.log("\nwhat the rest of the app still refuses:");
{
  // The admin can see who signed up. That must not have opened a door to
  // what they study.
  const userBlock = rules.slice(
    rules.indexOf("match /users/{uid}"),
    rules.indexOf("match /emailReminders")
  );
  check(
    "a user's own data is still owner-only",
    /request\.auth\.uid == uid/.test(userBlock) && !/isAdmin\(\)/.test(userBlock),
    "the owner of the site cannot read anybody's cards or notes"
  );
  check(
    "feedback is still unreadable from a browser",
    rules.includes("allow read, update, delete: if false")
  );
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
