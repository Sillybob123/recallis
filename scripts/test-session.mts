// Proves the progress bar counts retired cards, not raw answers.
type Item = { key: string };
function reinsert(prev: Item[], item: Item, at: number): Item[] {
  const rest = prev.slice(1);
  const pos = Math.min(at, rest.length);
  return [...rest.slice(0, pos), item, ...rest.slice(pos)];
}

let queue: Item[] = Array.from({ length: 5 }, (_, i) => ({ key: `c${i + 1}` }));
const total = queue.length;
let answers = 0, correct = 0;
const show = (label: string) =>
  console.log(
    `${label.padEnd(34)} progress ${total - queue.length}/${total}` +
    `  answers=${answers} accuracy=${answers ? Math.round((correct / answers) * 100) : 0}%` +
    `  next=${queue[0]?.key ?? "-"}`
  );

show("start");

// Fail c1 three times, then get it right
for (let i = 0; i < 3; i++) {
  answers++;
  queue = reinsert(queue, queue[0], 3);
  show(`c1 Again (#${i + 1})`);
}
answers++; correct++;
queue = queue.slice(1);
show("c1 Good -> retired");

// Clear the rest first try
while (queue.length) {
  answers++; correct++;
  queue = queue.slice(1);
}
show("remaining cleared");

console.log(`\nRetired ${total} cards from ${answers} answers ` +
  `(${answers - total} repeats). Accuracy ${Math.round((correct / answers) * 100)}%.`);
console.log("Progress never exceeded the denominator, and repeats didn't inflate it.");
