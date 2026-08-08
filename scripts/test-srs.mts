import { rate, previewIntervals, formatDelay, DEFAULT_SRS_CONFIG } from "../src/lib/srs";

const now = Date.now();
const DAY = 86400000;
// FSRS walkthrough: learn good (10m step graduates since 1 step), then goods over days
let s = rate(null, "good", now);
console.log("new+good → phase", s.phase, "ivl", s.ivl, "stab", s.stab?.toFixed(2), "diff", s.diff?.toFixed(2), "due in", formatDelay(s.due - now));
let t = now + s.ivl * DAY;
s = rate(s, "good", t);
console.log("review good → ivl", s.ivl, "stab", s.stab?.toFixed(2));
t += s.ivl * DAY;
s = rate(s, "good", t);
console.log("review good → ivl", s.ivl, "stab", s.stab?.toFixed(2));
t += s.ivl * DAY;
s = rate(s, "easy", t);
console.log("review easy → ivl", s.ivl, "stab", s.stab?.toFixed(2));
t += s.ivl * DAY;
s = rate(s, "again", t);
console.log("lapse → phase", s.phase, "stab", s.stab?.toFixed(2), "due in", formatDelay(s.due - t));
s = rate(s, "good", t + 600000);
console.log("relearn good → phase", s.phase, "ivl", s.ivl, "due in", formatDelay(s.due - t - 600000));
console.log("\npreviews new:", previewIntervals(null, now));
