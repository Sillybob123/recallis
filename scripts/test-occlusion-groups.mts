// Grouping masks means "ask these together, as one card". That has to hold
// everywhere a mask can come from, and everywhere cards get counted.
import { buildUnits } from "../src/lib/shapes";
import { buildOcclusionItems } from "../src/lib/studyItems";
import type { OcclusionShape } from "../src/types";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const rect = (id: string, groupId?: string): OcclusionShape =>
  ({ id, kind: "rect", x: 0, y: 0, w: 0.1, h: 0.1, groupId }) as OcclusionShape;

console.log("grouped masks are one card:");
{
  const units = buildUnits([rect("a", "G1"), rect("b", "G1")]);
  check("two grouped rectangles make one card", units.length === 1,
    `${units.length} card(s)`);
  check("and that card hides both", units[0].shapeIds.length === 2);
}
{
  const units = buildUnits([rect("a", "G1"), rect("c"), rect("b", "G1")]);
  check(
    "grouping holds even when the masks aren't adjacent",
    units.length === 2 && units[0].shapeIds.length === 2,
    units.map((u) => u.shapeIds.join("+")).join(" | ")
  );
}
{
  const units = buildUnits([
    rect("a", "G1"), rect("b", "G1"), rect("c", "G2"), rect("d", "G2"),
  ]);
  check("two groups make two cards, not four", units.length === 2);
}
{
  const units = buildUnits([rect("a", "G1"), rect("b", "G1"), rect("c")]);
  check("a loose mask beside a group still counts once", units.length === 2);
}

console.log("\nthe study session agrees:");
{
  const sheet = {
    id: "s1",
    deckId: "d1",
    title: "Brachial plexus",
    shapes: [rect("a", "G1"), rect("b", "G1"), rect("c")],
  } as never;
  const items = buildOcclusionItems([sheet]);
  check("three masks in two groups yield two study cards", items.length === 2,
    `${items.length} items`);
  const keys = new Set(items.map((i) => i.key));
  check("each card has its own key", keys.size === items.length);
  const grouped = items.find((i) => i.kind === "occlusion" && i.unit.shapeIds.length === 2);
  check("the grouped card covers both of its masks", !!grouped);
}

console.log("\nediting a group:");
{
  // Regrouping: selecting a member of one group with a loose mask rebuilds it.
  const shapes = [rect("a", "G1"), rect("b", "G1"), rect("c")];
  const regrouped = shapes.map((s) =>
    s.id === "a" || s.id === "c" ? { ...s, groupId: "G2" } : s
  );
  const units = buildUnits(regrouped);
  check(
    "the mask left behind becomes its own card",
    units.length === 2 &&
      units.some((u) => u.shapeIds.join("+") === "a+c") &&
      units.some((u) => u.shapeIds.join("+") === "b"),
    units.map((u) => u.shapeIds.join("+")).join(" | ")
  );
}
{
  const units = buildUnits([rect("a"), rect("b")]);
  check("ungrouped masks are still one card each", units.length === 2);
}
{
  // An empty groupId is not a group — it must not silently merge everything.
  const units = buildUnits([rect("a", ""), rect("b", "")]);
  check("an empty group id does not merge masks", units.length === 2);
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
