// Annotations mark an image up without ever being asked. The failure that
// would matter is one of them quietly becoming a card — you'd be tested on
// your own arrow — so most of this is about what buildUnits does and doesn't
// pick up.
import {
  annotationsOf,
  coversOf,
  annotationsForCard,
  annotationVisible,
  companionsFor,
  isCardShape,
  isCompanion,
  isCover,
  occlusionVisibility,
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

// ---------- covers ----------
// A cover exists to hide a spoiler printed on the slide. If it were ever
// revealed, or ever asked, it would be doing the opposite of its job.
console.log("\ncovers:");
{
  const cover = box("c", { cover: true });
  check("a cover is not an annotation", !isAnnotation(cover), "it hides, it doesn't mark");
  check("but it is a cover", isCover(cover));
  check("and it is never a card", !isCardShape(cover));
  check("while an ordinary mask is", isCardShape(box("m")));
  check("and so is a text-prompt mask", isCardShape(box("t", { textPrompt: true })));

  const shapes = [box("m1"), box("c1", { cover: true }), box("m2"), box("a1", { kind: "arrow" })];
  check("covers make no cards", buildUnits(shapes).map((u) => u.key).join() === "m1,m2");
  check("coversOf finds them", coversOf(shapes).length === 1);
  check(
    "a sheet of covers alone is not a sheet of cards",
    buildUnits([box("c1", { cover: true }), box("c2", { cover: true })]).length === 0
  );

  // A cover inside a group must not drag the group into existence either.
  const grouped = buildUnits([
    box("m1", { groupId: "g" }),
    box("c1", { cover: true, groupId: "g" }),
  ]);
  check("a group of one mask and one cover is one card", grouped.length === 1);
  check("made of just the mask", grouped[0].shapeIds.join() === "m1");
}

// ---------- masks that belong to one card ----------
// A label next to the structure you're asking about gives that one card
// away, but is perfectly fair on every other card. So it can be attached to
// specific masks: covered while they're asked, absent otherwise, never a
// question itself.
console.log("\nmasks tied to particular cards:");
{
  const m1 = box("m1", { x: 0.1, y: 0.1, w: 0.1, h: 0.1 });
  const m2 = box("m2", { x: 0.4, y: 0.1, w: 0.1, h: 0.1 });
  const helper = box("h1", { x: 0.7, y: 0.1, w: 0.1, h: 0.1, showsWith: ["m1"] });
  const shapes = [m1, m2, helper];

  check("a companion is recognised", isCompanion(helper));
  check("an ordinary mask isn't", !isCompanion(m1));
  check("and a companion is never asked", !isCardShape(helper));
  check(
    "so the sheet makes two cards, not three",
    buildUnits(shapes).map((u) => u.key).join() === "m1,m2"
  );

  check("it is found for the card it belongs to", [...companionsFor(shapes, ["m1"])].join() === "h1");
  check("and not for any other", companionsFor(shapes, ["m2"]).size === 0);

  // hideOne: only the asked mask is covered, so the companion matters most.
  const askingM1 = occlusionVisibility(shapes, ["m1"], "hideOne", false);
  check(
    "asking m1 covers m1 and its companion",
    [...askingM1.hidden].sort().join() === "h1,m1",
    [...askingM1.hidden].sort().join()
  );
  check("but only m1 is the question", [...askingM1.target].join() === "m1");
  const askingM2 = occlusionVisibility(shapes, ["m2"], "hideOne", false);
  check(
    "asking m2 leaves the companion off entirely",
    [...askingM2.hidden].join() === "m2",
    "it isn't covering anything on a card it has nothing to do with"
  );

  const answered = occlusionVisibility(shapes, ["m1"], "hideOne", true);
  check("on the answer nothing is covered", answered.hidden.size === 0);
  check("and the asked mask is outlined", [...(answered.outline ?? [])].join() === "m1");

  // hideAll: everything covered on the question either way.
  const allHidden = occlusionVisibility(shapes, ["m1"], "hideAll", false);
  check("hide-all covers everything", allHidden.hidden.size === 3);
  const allAnswered = occlusionVisibility(shapes, ["m1"], "hideAll", true);
  check(
    "and on its answer the companion lifts with its card",
    [...allAnswered.hidden].join() === "m2",
    "m1 is the answer and h1 was only hiding for m1's sake"
  );

  // Attached to several cards at once.
  const multi = [m1, m2, box("h2", { showsWith: ["m1", "m2"] })];
  check("a companion can follow more than one", companionsFor(multi, ["m2"]).size === 1);
  check("and still makes no card of its own", buildUnits(multi).length === 2);

  // Annotations are drawn by their own path, so they never appear here.
  const withArrow = [m1, box("a", { kind: "arrow" })];
  check(
    "an arrow is never in the hidden set",
    !occlusionVisibility(withArrow, ["m1"], "hideAll", false).hidden.has("a"),
    "it is drawn on top, not covered over"
  );
}

// ---------- explanations that wait for the answer ----------
// A note explaining the answer is worthless on the question side, and
// actively harmful: it is the answer, written out.
console.log("\nexplanations:");
{
  const m1 = box("m1");
  const m2 = box("m2");
  const always = box("n1", { kind: "note", label: "Anterior view" });
  const explain = box("n2", { kind: "note", label: "Why: recurrent laryngeal", onReveal: true });
  const tied = box("n3", {
    kind: "note",
    label: "Only for m1",
    onReveal: true,
    showsWith: ["m1"],
  });
  const shapes = [m1, m2, always, explain, tied];

  const onQuestion = annotationsForCard(shapes, { revealed: false, unitShapeIds: ["m1"] });
  check(
    "the question side shows only the plain label",
    onQuestion.map((s) => s.id).join() === "n1",
    onQuestion.map((s) => s.id).join()
  );

  const onAnswer = annotationsForCard(shapes, { revealed: true, unitShapeIds: ["m1"] });
  check(
    "the answer adds both explanations",
    onAnswer.map((s) => s.id).sort().join() === "n1,n2,n3",
    onAnswer.map((s) => s.id).sort().join()
  );

  const otherAnswer = annotationsForCard(shapes, { revealed: true, unitShapeIds: ["m2"] });
  check(
    "another card's answer leaves the tied one out",
    otherAnswer.map((s) => s.id).sort().join() === "n1,n2",
    "that's the whole point of tying it"
  );

  check(
    "an explanation is never a card",
    buildUnits(shapes).map((u) => u.key).join() === "m1,m2"
  );
  check(
    "and a tied note is not treated as a mask to fill in",
    !companionsFor(shapes, ["m1"]).has("n3"),
    "it is drawn, not covered over"
  );
  check(
    "so asking m1 covers only m1",
    [...occlusionVisibility(shapes, ["m1"], "hideOne", false).hidden].join() === "m1"
  );

  check(
    "visibility is decided per shape too",
    !annotationVisible(explain, { revealed: false, unitShapeIds: [] }) &&
      annotationVisible(explain, { revealed: true, unitShapeIds: [] })
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
