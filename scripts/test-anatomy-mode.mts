// Anatomy mode is only worth having if it's right. A wrong gloss delivered
// confidently is worse than no gloss, so this checks both directions: real
// terms are explained correctly, and ordinary English is left alone.
import { glossWord, glossText } from "../src/lib/anatomyAnnotate";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---------- terms that must be explained, and explained correctly ----------
console.log("anatomical vocabulary:");
const shouldGloss: [string, string[]][] = [
  ["subcutaneous", ["under", "skin"]],
  ["intercostal", ["between", "rib"]],
  ["myocardium", ["muscle", "heart"]],
  ["osteoblast", ["bone", "immature"]],
  ["osteoclast", ["bone", "breaks down"]],
  ["gastroenterology", ["stomach", "intestine", "study"]],
  ["epidermis", ["upon", "skin"]],
  ["hypoglycemia", ["below", "sugar", "blood"]],
  ["cardiovascular", ["heart", "vessel"]],
  ["nephrectomy", ["kidney", "removal"]],
  ["thoracotomy", ["chest", "incision"]],
  ["arthroscopy", ["joint", "examination"]],
  ["encephalopathy", ["brain", "disease"]],
  ["erythrocyte", ["red", "cell"]],
  ["leukocytes", ["white", "cell"]],
  ["adrenal", ["toward", "kidney"]],
  ["epinephrine", ["upon", "kidney"]],
  ["pericardium", ["around", "heart"]],
  ["intravenous", ["within", "vein"]],
  ["sternotomy", ["sternum", "incision"]],
  ["mastectomy", ["breast", "removal"]],
  ["tachycardia", ["fast", "heart"]],
  ["bradycardia", ["slow", "heart"]],
  ["hepatitis", ["liver", "inflammation"]],
  ["chondrocytes", ["cartilage", "cell"]],
];
for (const [word, expected] of shouldGloss) {
  const g = glossWord(word);
  if (!g) {
    check(word, false, "not glossed at all");
    continue;
  }
  const text = glossText(g).toLowerCase();
  const missing = expected.filter((e) => !text.includes(e.toLowerCase()));
  check(
    `${word} → ${glossText(g)}`,
    missing.length === 0,
    missing.length ? `missing ${missing.join(", ")}` : ""
  );
}

// ---------- whole Latin terms ----------
console.log("\nLatin terms glossed whole:");
for (const [word, expect] of [
  ["rectus", "straight"],
  ["latissimus", "widest"],
  ["pollicis", "thumb"],
  ["hallucis", "great toe"],
  ["digitorum", "fingers"],
  ["sartorius", "tailor"],
  ["flexor", "bender"],
  ["abductor", "away"],
  ["glomerulus", "ball of yarn"],
  ["trochanter", "runner"],
  ["olecranon", "elbow"],
] as const) {
  const g = glossWord(word);
  check(
    `${word} → ${g ? glossText(g) : "(none)"}`,
    !!g && glossText(g).toLowerCase().includes(expect)
  );
}

// ---------- ordinary English must be untouched ----------
console.log("\nleft alone:");
const shouldNotGloss = [
  // caught by the audit against the real collection
  "process", "processes", "major", "majority", "minor", "prone",
  "intervene", "intervenes", "histogram", "phrenology", "adenosine",
  // everyday words that decompose convincingly
  "central", "capital", "material", "personal", "national", "general",
  "several", "internal", "external", "terminal", "interest", "interval",
  "subject", "substance", "suburb", "postal", "poster", "position",
  "product", "protect", "program", "transfer", "translate", "transport",
  "isolate", "parent", "parallel", "period", "person", "perfect",
  "district", "disease", "display", "different", "digest", "dinner",
  "metal", "method", "mention", "member", "message", "middle",
  "muscle", "matter", "measure", "mistake", "moment", "monitor",
  "stomach", "student", "structure", "strength", "surgery", "symptom",
  "system", "science", "section", "sentence", "separate", "society",
  // short words where coincidence dominates
  "the", "and", "cat", "dog", "part", "cost", "dent", "mast", "colon",
];
let noise = 0;
for (const w of shouldNotGloss) {
  const g = glossWord(w);
  if (g) {
    noise++;
    console.log(`FAIL  "${w}" was glossed as "${glossText(g)}"`);
  }
}
failures += noise;
check(
  `${shouldNotGloss.length} ordinary words all left alone`,
  noise === 0,
  noise ? `${noise} highlighted` : ""
);

// ---------- structural guarantees ----------
console.log("\nrules:");
check("a lone root is not enough", glossWord("cardio") === null, "needs 2+ parts");
check(
  "prefix + ending with no root is refused",
  glossWord("interest") === null && glossWord("subtle") === null
);
check("numbers and mixed tokens are ignored", glossWord("h2o") === null);
check("empty input is safe", glossWord("") === null);
check(
  "a word that only partly matches is refused",
  glossWord("cardiplumbus") === null,
  "no partial credit"
);
check(
  "case does not matter",
  glossText(glossWord("Subcutaneous")!) === glossText(glossWord("subcutaneous")!)
);

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
