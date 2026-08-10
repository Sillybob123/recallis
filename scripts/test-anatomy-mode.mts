// Anatomy mode is only worth having if it's right. A wrong gloss delivered
// confidently is worse than no gloss, so this checks both directions: real
// terms are explained correctly, and ordinary English is left alone.
import { glossWord, glossText } from "../src/lib/anatomyAnnotate";
import { searchReference, ANATOMY_REFERENCE } from "../src/lib/anatomyReference";

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
  // added when the dictionary was widened
  ["laparotomy", ["abdominal", "incision"]],
  ["cholecystectomy", ["gallbladder", "removal"]],
  ["splanchnology", ["viscera", "study"]],
  ["rhabdomyolysis", ["rod-shaped", "muscle", "breakdown"]],
  ["xeroderma", ["dry", "skin"]],
  ["haematopoiesis", ["blood", "production"]],
  ["polyuria", ["many", "urine"]],
  ["tympanostomy", ["eardrum", "opening"]],
  ["scoliosis", ["twisted", "abnormal condition"]],
  ["lymphocyte", ["lymph", "cell"]],
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

// ---------- the lookup panel ----------
console.log("\nroot search:");
{
  const top = (q: string) => searchReference(q)[0]?.form ?? "(none)";
  const hits = (q: string) => searchReference(q).map((e) => e.form);

  check(`"cyto" leads with the cell root — ${top("cyto")}`,
    top("cyto").startsWith("cyt"));
  check(`"nephr" leads with the kidney root — ${top("nephr")}`,
    top("nephr").startsWith("nephr"));
  check(`"-itis" finds inflammation — ${top("-itis")}`,
    searchReference("-itis")[0]?.meaning === "inflammation",
    "leading hyphens are ignored");
  check(`"ectomy" finds removal — ${top("ectomy")}`,
    (searchReference("ectomy")[0]?.meaning ?? "").includes("removal"));

  // Searching by meaning, which is how you use it when you don't know the root.
  check(
    `"kidney" finds both roots — ${hits("kidney").slice(0, 3).join(", ")}`,
    hits("kidney").some((f) => f.startsWith("nephr")) &&
      hits("kidney").some((f) => f.startsWith("ren"))
  );
  check(
    `"heart" finds cardi- — ${hits("heart").slice(0, 2).join(", ")}`,
    hits("heart").some((f) => f.startsWith("cardi"))
  );
  // The widened reference should answer the everyday ones too.
  for (const [q, expect] of [
    ["lapar", "abdominal"],
    ["-poiesis", "production"],
    ["rhabd", "rod"],
    ["pachy", "thick"],
    ["left", "left"],
    ["yellow", "yellow"],
    ["gallbladder", "gallbladder"],
  ] as const) {
    const found = searchReference(q);
    check(
      `"${q}" is answered — ${found[0]?.form ?? "(none)"}`,
      found.some((e) =>
        `${e.form} ${e.meaning}`.toLowerCase().includes(expect.toLowerCase())
      )
    );
  }

  check("an empty query returns nothing", searchReference("").length === 0);
  check("a nonsense query returns nothing", searchReference("qqzzx").length === 0);
  check(
    "results are capped",
    searchReference("a", 5).length <= 5,
    "the panel must not render hundreds of rows"
  );

  // The data itself should be well formed.
  const bad = ANATOMY_REFERENCE.filter((e) => !e.form || !e.meaning);
  check(`${ANATOMY_REFERENCE.length} entries, all with a form and a meaning`,
    bad.length === 0, bad.map((b) => b.form).join(", "));
  const dupes = ANATOMY_REFERENCE.map((e) => e.form).filter(
    (f, i, all) => all.indexOf(f) !== i
  );
  check("no duplicate entries", dupes.length === 0, dupes.join(", "));
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
