// Annotations mark an image up without ever being asked. The failure that
// would matter is one of them quietly becoming a card — you'd be tested on
// your own arrow — so most of this is about what buildUnits does and doesn't
// pick up.
import {
  annotationsOf,
  arrowEnds,
  arrowHead,
  boxesIntersect,
  buildUnits,
  isAnnotation,
  masksOf,
  starPoints,
} from "../src/lib/shapes";
import type { OcclusionShape } from "../src/types";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const box = (id: string, over: Partial<OcclusionShape> = {}): OcclusionShape => ({
  id,
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.2,
  ...over,
});

// ---------- what counts as an annotation ----------
console.log("telling the two apart:");
{
  check("a plain rect is a mask", !isAnnotation(box("m")));
  check("so is one with no kind at all", !isAnnotation({ id: "x", x: 0, y: 0, w: 0.1, h: 0.1 }));
  check("an arrow is not", isAnnotation(box("a", { kind: "arrow" })));
  check("a star is not", isAnnotation(box("s", { kind: "star" })));
  check("a note is not", isAnnotation(box("n", { kind: "note", label: "important" })));
  check(
    "the flag alone is enough",
    isAnnotation(box("f", { annotation: true })),
    "a client too old to know the kind still won't ask about it"
  );
  check(
    "a text-prompt mask is still a mask",
    !isAnnotation(box("t", { textPrompt: true, label: "What is this?" })),
    "that one is a question"
  );
}

// ---------- the thing that must never happen ----------
console.log("\nannotations never become cards:");
{
  const shapes = [
    box("m1"),
    box("a1", { kind: "arrow" }),
    box("m2"),
    box("s1", { kind: "star" }),
    box("n1", { kind: "note", label: "this is important" }),
  ];
  const units = buildUnits(shapes);
  check("only the masks make units", units.length === 2, `${units.length}`);
  check(
    "and they're the right two",
    units.map((u) => u.key).join() === "m1,m2",
    units.map((u) => u.key).join()
  );
  check("masksOf agrees", masksOf(shapes).length === 2);
  check("annotationsOf gets the rest", annotationsOf(shapes).length === 3);

  check(
    "a sheet of nothing but annotations makes no cards at all",
    buildUnits([box("a", { kind: "arrow" }), box("s", { kind: "star" })]).length === 0
  );

  // Grouping is a mask idea; an annotation carrying a stray groupId must not
  // conjure a unit out of nothing.
  const withGroup = buildUnits([
    box("m1", { groupId: "g" }),
    box("m2", { groupId: "g" }),
    box("a1", { kind: "arrow", groupId: "g" }),
  ]);
  check("a group is still one unit", withGroup.length === 1);
  check(
    "and the arrow isn't in it",
    withGroup[0].shapeIds.join() === "m1,m2",
    withGroup[0].shapeIds.join()
  );
}

// ---------- geometry ----------
console.log("\ndrawing them:");
{
  const star = box("s", { kind: "star", x: 0, y: 0, w: 0.4, h: 0.4 });
  const pts = starPoints(star);
  check("a star has ten points", pts.length === 10, "five out, five in");
  check(
    "the first is the top",
    Math.abs(pts[0].x - 0.2) < 1e-9 && pts[0].y < 0.01,
    `${pts[0].x},${pts[0].y}`
  );
  check(
    "every point is inside its box",
    pts.every((p) => p.x >= -1e-9 && p.x <= 0.4 && p.y >= -1e-9 && p.y <= 0.4)
  );
  check(
    "inner points are nearer the middle than outer ones",
    Math.hypot(pts[1].x - 0.2, pts[1].y - 0.2) < Math.hypot(pts[0].x - 0.2, pts[0].y - 0.2)
  );

  const arrow = box("a", { kind: "arrow", points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] });
  const { from, to } = arrowEnds(arrow);
  check("an arrow keeps its direction", from.x === 0.1 && to.x === 0.5, "tail to head, not a box");
  const noPoints = box("a2", { kind: "arrow", x: 0.2, y: 0.2, w: 0.3, h: 0.1 });
  check(
    "one without points falls back to its diagonal",
    arrowEnds(noPoints).to.x === 0.5 && arrowEnds(noPoints).to.y === 0.30000000000000004
  );

  const head = arrowHead(from, to, 0.006);
  check("the head has three points", head.length === 3);
  check("its tip is the arrow's tip", head[1].x === to.x && head[1].y === to.y);
  const short = arrowHead({ x: 0.5, y: 0.5 }, { x: 0.52, y: 0.5 }, 0.006);
  const shortSize = Math.hypot(short[0].x - short[1].x, short[0].y - short[1].y);
  check(
    "a short arrow gets a smaller head",
    shortSize < 0.02,
    "otherwise the head is bigger than the arrow"
  );
}

// ---------- the marquee ----------
console.log("\nlassoing several at once:");
{
  const band = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 };
  check("a shape inside is caught", boxesIntersect(band, box("a", { x: 0.15, y: 0.15, w: 0.05, h: 0.05 })));
  check(
    "one merely touched at a corner is caught too",
    boxesIntersect(band, box("b", { x: 0.35, y: 0.35, w: 0.2, h: 0.2 })),
    "brushing it is enough — you shouldn't have to enclose it exactly"
  );
  check(
    "one outside is not",
    !boxesIntersect(band, box("c", { x: 0.6, y: 0.6, w: 0.1, h: 0.1 }))
  );
  check(
    "and one sharing only an edge is not",
    !boxesIntersect(band, box("d", { x: 0.4, y: 0.1, w: 0.1, h: 0.1 })),
    "a zero-area overlap isn't a selection"
  );
  check(
    "a click on empty space catches nothing",
    !boxesIntersect({ x: 0.8, y: 0.8, w: 0, h: 0 }, box("e")),
    "which is how clicking away clears the selection"
  );
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
