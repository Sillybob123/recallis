import { gradeAnswer } from "../src/lib/text";
const cases: [string, string, string, boolean][] = [
  ["strict", "Doyen Retractor", "doyen retractor", true],
  ["strict", "Doyen Retracter", "doyen retractor", false],
  ["moderate", "Doyen Retracter", "Doyen Retractor", true],
  ["moderate", "Balfour", "Doyen Retractor", false],
  ["relaxed", "large curved retractor for organs", "a large curved retractor with a handle used to hold soft organs", false],
  ["relaxed", "holds soft organs out of the way with wide contact", "a large curved retractor used to hold soft organs out of the way", false],
  ["relaxed", "median plane", "the median plane", true],
  ["relaxed", "medial plane", "median plane", true],
];
for (const [lvl, typed, correct, _] of cases) {
  console.log(`${lvl.padEnd(8)} "${typed}" vs "${correct}" ->`, gradeAnswer(typed, correct, lvl as any));
}
