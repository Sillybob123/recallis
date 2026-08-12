import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Type,
  Circle,
  Copy,
  Group,
  MessageSquare,
  Eye,
  EyeOff,
  MousePointer2,
  Pentagon,
  Redo2,
  Square,
  Lightbulb,
  Link2,
  Star,
  Trash2,
  Undo2,
  Ungroup,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Layout } from "../components/Layout";
import { NoteBox, useBoxSize } from "../components/NoteBox";
import {
  createOcclusionSheet,
  getOcclusionSheet,
  updateOcclusionSheet,
  uploadOcclusionImage,
} from "../lib/firestore";
import {
  annotationWeight,
  arrowEnds,
  arrowHead,
  boxesIntersect,
  buildUnits,
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_MASK_COLOR,
  isAnnotation,
  isCardShape,
  isCompanion,
  isCover,
  polygonBounds,
  shapeColor,
  shapeKind,
  shapeOpacity,
  starPoints,
  translateShape,
} from "../lib/shapes";
import type { OcclusionShape, ShapeKind } from "../types";
import { uid } from "../lib/uid";

/** Covers default to near-black: unambiguous, and clearly not a mask. */
const COVER_COLOR = "#0f172a";

/** Explanations get their own colour so a glance tells them from a label. */
const EXPLAIN_COLOR = "#b45309";

const MASK_COLORS = [DEFAULT_MASK_COLOR, "#ef4444", "#10b981", "#f59e0b", "#a855f7", "#ec4899", "#334155"];

type Tool =
  | "select"
  | "rect"
  | "ellipse"
  | "polygon"
  | "textbox"
  | "note"
  | "arrow"
  | "star"
  | "explain"
  | "cover";

/** The tools that mark the image up instead of covering it. */
const ANNOTATION_TOOLS: Tool[] = ["note", "arrow", "star", "explain"];

interface DragState {
  mode: "draw" | "move" | "resize" | "vertex" | "marquee";
  startX: number;
  startY: number;
  /** original shapes at drag start, for move/resize/vertex */
  originals?: Map<string, OcclusionShape>;
  shapeId?: string;
  vertexIndex?: number;
  /** which dimensions a resize changes */
  axis?: "both" | "x" | "y";
  moved?: boolean;
  /** set once this drag has recorded its undo step */
  snapshotted?: boolean;
  /** marquee only: the selection at drag start, for shift-adding */
  baseSelection?: Set<string>;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

/**
 * An arrow or star on the editing canvas. Drawn the same way the study view
 * draws it, with a wider invisible hit area so a thin arrow is still easy to
 * grab.
 */
function EditorAnnotation({
  shape,
  selected,
  onPointerDown,
}: {
  shape: OcclusionShape;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const color = shapeColor(shape);
  const grab = {
    style: { pointerEvents: "auto" as const, cursor: "move" },
    onPointerDown,
  };
  if (shapeKind(shape) === "arrow") {
    const { from, to } = arrowEnds(shape);
    const head = arrowHead(from, to, annotationWeight(shape));
    return (
      <g>
        <line
          x1={from.x * 100}
          y1={from.y * 100}
          x2={to.x * 100}
          y2={to.y * 100}
          stroke="transparent"
          strokeWidth={12}
          vectorEffect="non-scaling-stroke"
          {...grab}
        />
        <line
          x1={from.x * 100}
          y1={from.y * 100}
          x2={to.x * 100}
          y2={to.y * 100}
          stroke={color}
          strokeWidth={selected ? 5 : 3}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
        <polygon
          points={head.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
          fill={color}
          pointerEvents="none"
        />
      </g>
    );
  }
  if (shapeKind(shape) === "star") {
    return (
      <polygon
        points={starPoints(shape).map((p) => `${p.x * 100},${p.y * 100}`).join(" ")}
        fill={color}
        stroke={selected ? "#1e293b" : "rgba(255,255,255,0.9)"}
        strokeWidth={selected ? 2 : 1}
        vectorEffect="non-scaling-stroke"
        {...grab}
      />
    );
  }
  return null;
}

export function OcclusionEditor() {
  const { deckId, sheetId } = useParams();
  const [searchParams] = useSearchParams();
  // Opened from a lecture note? Go back there (and to the slide) on save.
  const returnTo = searchParams.get("returnTo");
  const { user } = useAuth();
  const navigate = useNavigate();
  const goBack = () => navigate(returnTo || `/deck/${deckId}`);

  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [imgDims, setImgDims] = useState({ width: 0, height: 0 });
  const [shapes, setShapes] = useState<OcclusionShape[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState<Tool>("rect");
  const [drag, setDrag] = useState<DragState | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [polyDraft, setPolyDraft] = useState<{ x: number; y: number }[]>([]);
  const [polyHover, setPolyHover] = useState<{ x: number; y: number } | null>(null);
  const [defaultColor, setDefaultColor] = useState(DEFAULT_MASK_COLOR);
  const [defaultOpacity, setDefaultOpacity] = useState(1);
  const [loading, setLoading] = useState(Boolean(sheetId));
  const [saving, setSaving] = useState(false);
  /**
   * How the sheet asks its masks. Chosen when saving rather than while
   * studying, because it is a property of the picture: a diagram of one
   * structure wants everything covered, a labelled overview reads better with
   * only the asked label hidden.
   */
  const [revealMode, setRevealMode] = useState<"hideAll" | "hideOne">("hideAll");
  const [annotationColor, setAnnotationColor] = useState(DEFAULT_ANNOTATION_COLOR);
  /**
   * The mask currently being attached to other masks. While this is set,
   * clicking a mask toggles whether this one appears on that mask's card.
   */
  const [linking, setLinking] = useState<string | null>(null);
  // The drag handlers are bound once per drag, so they read the live shapes
  // through a ref rather than a stale closure.
  const shapesRef = useRef<OcclusionShape[]>([]);
  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  // ---------- undo ----------
  // Snapshots of the whole shape list, taken before each edit. There are
  // rarely more than a few dozen shapes, so copying the lot is simpler and
  // more reliable than describing every edit as an invertible operation.
  const historyRef = useRef<OcclusionShape[][]>([]);
  const futureRef = useRef<OcclusionShape[][]>([]);
  const coalesceRef = useRef<{ tag: string; at: number } | null>(null);
  const [historyTick, setHistoryTick] = useState(0);

  const copyShapes = (list: OcclusionShape[]) =>
    list.map((s) => (s.points ? { ...s, points: s.points.map((p) => ({ ...p })) } : { ...s }));

  /**
   * Records the state to come back to. `tag` coalesces a run of edits that
   * are really one gesture — typing a label shouldn't cost you thirty
   * undos to get past.
   */
  const snapshot = useCallback((tag = "") => {
    const now = Date.now();
    if (
      tag &&
      coalesceRef.current &&
      coalesceRef.current.tag === tag &&
      now - coalesceRef.current.at < 800
    ) {
      coalesceRef.current.at = now;
      return;
    }
    coalesceRef.current = tag ? { tag, at: now } : null;
    historyRef.current.push(copyShapes(shapesRef.current));
    if (historyRef.current.length > 120) historyRef.current.shift();
    futureRef.current = [];
    setHistoryTick((t) => t + 1);
  }, []);

  const undo = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    futureRef.current.push(copyShapes(shapesRef.current));
    coalesceRef.current = null;
    setShapes(previous);
    // Anything that no longer exists can't stay selected.
    const alive = new Set(previous.map((s) => s.id));
    setSelectedIds((prev) => new Set([...prev].filter((id) => alive.has(id))));
    setHistoryTick((t) => t + 1);
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current.push(copyShapes(shapesRef.current));
    coalesceRef.current = null;
    setShapes(next);
    const alive = new Set(next.map((s) => s.id));
    setSelectedIds((prev) => new Set([...prev].filter((id) => alive.has(id))));
    setHistoryTick((t) => t + 1);
  }, []);

  const canUndo = historyRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  void historyTick;

  const containerRef = useRef<HTMLDivElement>(null);
  // The image's drawn size in pixels, so note text can be fitted to its box.
  const canvasSize = useBoxSize(containerRef);
  const isEditing = Boolean(sheetId);

  useEffect(() => {
    if (!sheetId || !user || !deckId) return;
    getOcclusionSheet(user.uid, deckId, sheetId).then((sheet) => {
      if (!sheet) {
        goBack();
        return;
      }
      setTitle(sheet.title);
      setImgSrc(sheet.imageUrl);
      setImgDims({ width: sheet.imageWidth, height: sheet.imageHeight });
      setShapes(sheet.shapes);
      setRevealMode(sheet.revealMode ?? "hideAll");
      setLoading(false);
    });
  }, [sheetId, user, deckId, navigate]);

  const handleFileSelect = useCallback((f: File) => {
    setFile(f);
    setImgSrc(URL.createObjectURL(f));
    setTitle((t) => t || f.name.replace(/\.[^.]+$/, ""));
  }, []);

  // Paste an image straight from the clipboard (e.g. a screenshotted slide).
  useEffect(() => {
    if (isEditing) return;
    function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith("image/")
      );
      const f = item?.getAsFile();
      if (f) {
        e.preventDefault();
        handleFileSelect(f);
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [isEditing, handleFileSelect]);

  function relPos(clientX: number, clientY: number) {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: clamp((clientX - rect.left) / rect.width, 0, 1),
      y: clamp((clientY - rect.top) / rect.height, 0, 1),
    };
  }

  // ---------- selection / editing helpers ----------

  function selectOnly(id: string, additive: boolean) {
    setSelectedIds((prev) => {
      if (additive) {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }
      return prev.has(id) ? prev : new Set([id]);
    });
  }

  function deleteSelected() {
    if (!selectedIds.size) return;
    snapshot();
    setShapes((prev) => prev.filter((s) => !selectedIds.has(s.id)));
    setSelectedIds(new Set());
  }

  function duplicateSelected() {
    if (!selectedIds.size) return;
    snapshot();
    const groupRemap = new Map<string, string>();
    const clones: OcclusionShape[] = [];
    for (const s of shapes) {
      if (!selectedIds.has(s.id)) continue;
      let groupId = s.groupId;
      if (groupId) {
        if (!groupRemap.has(groupId)) groupRemap.set(groupId, uid());
        groupId = groupRemap.get(groupId);
      }
      clones.push(
        translateShape({ ...s, id: uid(), groupId }, 0.03, 0.03)
      );
    }
    if (clones.length) {
      setShapes((prev) => [...prev, ...clones]);
      setSelectedIds(new Set(clones.map((c) => c.id)));
    }
  }

  function groupSelected() {
    // Annotations aren't cards, so there is nothing to group them into — a
    // marquee that caught an arrow along with four masks should still group
    // the four masks.
    const maskIds = shapes
      .filter((s) => selectedIds.has(s.id) && !isAnnotation(s))
      .map((s) => s.id);
    if (maskIds.length < 2) return;
    snapshot();
    const gid = uid();
    const inGroup = new Set(maskIds);
    setShapes((prev) =>
      prev.map((s) => (inGroup.has(s.id) ? { ...s, groupId: gid } : s))
    );
  }

  function ungroupSelected() {
    if (!selectedIds.size) return;
    snapshot();
    setShapes((prev) =>
      prev.map((s) =>
        selectedIds.has(s.id) ? { ...s, groupId: undefined } : s
      )
    );
  }

  function applyColor(color: string) {
    if (selectedIds.size) snapshot("color");
    // Masks and annotations keep separate defaults — you don't want the
    // colour you picked for an arrow to become the colour of your masks.
    if (ANNOTATION_TOOLS.includes(tool)) setAnnotationColor(color);
    else setDefaultColor(color);
    if (selectedIds.size) {
      setShapes((prev) =>
        prev.map((s) => (selectedIds.has(s.id) ? { ...s, color } : s))
      );
    }
  }

  function applyOpacity(opacity: number) {
    if (selectedIds.size) snapshot("opacity");
    setDefaultOpacity(opacity);
    if (selectedIds.size) {
      setShapes((prev) =>
        prev.map((s) => (selectedIds.has(s.id) ? { ...s, opacity } : s))
      );
    }
  }

  function updateLabel(id: string, label: string) {
    snapshot(`label:${id}`);
    setShapes((prev) => prev.map((s) => (s.id === id ? { ...s, label } : s)));
  }

  // Keyboard: delete, duplicate, escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === "Escape") {
        setLinking(null);
        setPolyDraft([]);
        setPolyHover(null);
        setSelectedIds(new Set());
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        // Shift-Z redoes, matching every drawing tool people already use.
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (e.key === "Enter" && polyDraft.length >= 3) {
        commitPolygon();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- drawing ----------

  function commitPolygon() {
    if (polyDraft.length >= 3) {
      snapshot();
      const b = polygonBounds(polyDraft);
      const id = uid();
      setShapes((prev) => [
        ...prev,
        {
          id,
          kind: "polygon",
          ...b,
          points: polyDraft,
          color: defaultColor,
          opacity: defaultOpacity,
          label: "",
        },
      ]);
      setSelectedIds(new Set([id]));
    }
    setPolyDraft([]);
    setPolyHover(null);
  }

  function handleCanvasPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const pos = relPos(e.clientX, e.clientY);
    if (tool === "polygon") {
      // Close if clicking near the first point.
      if (polyDraft.length >= 3) {
        const first = polyDraft[0];
        const rect = containerRef.current!.getBoundingClientRect();
        const distPx = Math.hypot(
          (pos.x - first.x) * rect.width,
          (pos.y - first.y) * rect.height
        );
        if (distPx < 12) {
          commitPolygon();
          return;
        }
      }
      setPolyDraft((prev) => [...prev, pos]);
      return;
    }
    if (
      tool === "rect" ||
      tool === "ellipse" ||
      tool === "textbox" ||
      tool === "cover" ||
      ANNOTATION_TOOLS.includes(tool)
    ) {
      setSelectedIds(new Set());
      setDrag({ mode: "draw", startX: pos.x, startY: pos.y });
      setDraft({ x: pos.x, y: pos.y, w: 0, h: 0 });
      return;
    }
    // Select tool on empty canvas: start a rubber band. Picking out eight
    // masks to group them shouldn't mean eight shift-clicks.
    setDrag({
      mode: "marquee",
      startX: pos.x,
      startY: pos.y,
      baseSelection: e.shiftKey ? new Set(selectedIds) : new Set(),
    });
    setDraft({ x: pos.x, y: pos.y, w: 0, h: 0 });
    if (!e.shiftKey) setSelectedIds(new Set());
  }

  function handleShapePointerDown(e: React.PointerEvent, shape: OcclusionShape) {
    if (tool === "polygon") return; // clicks pass through while drawing
    e.stopPropagation();
    if (linking) {
      if (shape.id === linking) return;
      // Only something that is actually asked can host: you attach a note to
      // the card it explains, not to another note.
      if (!isCardShape(shape)) return;
      snapshot();
      setShapes((prev) =>
        prev.map((s) => {
          if (s.id !== linking) return s;
          const current = s.showsWith ?? [];
          const next = current.includes(shape.id)
            ? current.filter((id) => id !== shape.id)
            : [...current, shape.id];
          return { ...s, showsWith: next.length ? next : undefined };
        })
      );
      return;
    }
    // With the text tool active, clicking an existing mask turns it into a
    // text box (or edits the prompt of one that already is).
    if (tool === "textbox" && !isAnnotation(shape)) {
      const asked = prompt(
        "Question to show on this box:",
        shape.textPrompt ? shape.label ?? "" : ""
      );
      if (asked === null) return;
      snapshot();
      const text = asked.trim();
      setShapes((prev) =>
        prev.map((sh) =>
          sh.id === shape.id
            ? { ...sh, label: text, textPrompt: text ? true : undefined }
            : sh
        )
      );
      setSelectedIds(new Set([shape.id]));
      return;
    }
    const pos = relPos(e.clientX, e.clientY);
    const additive = e.shiftKey;
    selectOnly(shape.id, additive);
    if (additive) return;
    // Move every selected shape (falling back to just this one).
    const moveIds = selectedIds.has(shape.id) ? selectedIds : new Set([shape.id]);
    const originals = new Map<string, OcclusionShape>();
    for (const s of shapes) {
      if (moveIds.has(s.id)) originals.set(s.id, s);
    }
    setDrag({ mode: "move", startX: pos.x, startY: pos.y, originals });
  }

  function handleResizePointerDown(
    e: React.PointerEvent,
    shape: OcclusionShape,
    axis: "both" | "x" | "y" = "both"
  ) {
    e.stopPropagation();
    const pos = relPos(e.clientX, e.clientY);
    const originals = new Map<string, OcclusionShape>([[shape.id, shape]]);
    setDrag({
      mode: "resize",
      startX: pos.x,
      startY: pos.y,
      originals,
      shapeId: shape.id,
      axis,
    });
  }

  function handleVertexPointerDown(
    e: React.PointerEvent,
    shape: OcclusionShape,
    vertexIndex: number
  ) {
    e.stopPropagation();
    const pos = relPos(e.clientX, e.clientY);
    setDrag({
      mode: "vertex",
      startX: pos.x,
      startY: pos.y,
      originals: new Map([[shape.id, shape]]),
      shapeId: shape.id,
      vertexIndex,
    });
  }

  useEffect(() => {
    if (!drag) return;

    /** One history entry per drag, recorded the moment it starts changing. */
    function beginDragEdit() {
      if (drag!.snapshotted) return;
      drag!.snapshotted = true;
      snapshot();
    }

    function onMove(e: PointerEvent) {
      const pos = relPos(e.clientX, e.clientY);
      const dx = pos.x - drag!.startX;
      const dy = pos.y - drag!.startY;
      if (drag!.mode === "draw" || drag!.mode === "marquee") {
        const box = {
          x: Math.min(drag!.startX, pos.x),
          y: Math.min(drag!.startY, pos.y),
          w: Math.abs(dx),
          h: Math.abs(dy),
        };
        setDraft(box);
        if (drag!.mode === "marquee") {
          // Live, so you can see what you're about to catch.
          const caught = new Set(drag!.baseSelection ?? []);
          for (const s of shapesRef.current) {
            if (boxesIntersect(box, s)) caught.add(s.id);
          }
          setSelectedIds(caught);
        }
      } else if (drag!.mode === "move" && drag!.originals) {
        // Taken on the first real movement, not at pointer-down: clicking a
        // shape to select it must not cost an undo that does nothing.
        beginDragEdit();
        drag!.moved = true;
        setShapes((prev) =>
          prev.map((s) => {
            const orig = drag!.originals!.get(s.id);
            return orig ? translateShape(orig, dx, dy) : s;
          })
        );
      } else if (drag!.mode === "resize" && drag!.originals && drag!.shapeId) {
        beginDragEdit();
        const orig = drag!.originals.get(drag!.shapeId)!;
        // An edge handle changes one dimension; the corner changes both.
        const axis = drag!.axis ?? "both";
        const nw =
          axis === "y" ? orig.w : clamp(orig.w + dx, 0.015, 1 - orig.x);
        const nh =
          axis === "x" ? orig.h : clamp(orig.h + dy, 0.015, 1 - orig.y);
        setShapes((prev) =>
          prev.map((s) => {
            if (s.id !== drag!.shapeId) return s;
            if (shapeKind(orig) === "polygon" && orig.points) {
              // Scale polygon points around the top-left corner.
              const sx = orig.w > 0 ? nw / orig.w : 1;
              const sy = orig.h > 0 ? nh / orig.h : 1;
              const points = orig.points.map((p) => ({
                x: orig.x + (p.x - orig.x) * sx,
                y: orig.y + (p.y - orig.y) * sy,
              }));
              return { ...orig, ...polygonBounds(points), points };
            }
            return { ...orig, w: nw, h: nh };
          })
        );
      } else if (
        drag!.mode === "vertex" &&
        drag!.originals &&
        drag!.shapeId &&
        drag!.vertexIndex !== undefined
      ) {
        beginDragEdit();
        const orig = drag!.originals.get(drag!.shapeId)!;
        if (!orig.points) return;
        const points = orig.points.map((p, i) =>
          i === drag!.vertexIndex ? { x: pos.x, y: pos.y } : p
        );
        setShapes((prev) =>
          prev.map((s) =>
            s.id === drag!.shapeId
              ? { ...orig, ...polygonBounds(points), points }
              : s
          )
        );
      }
    }

    function onUp(e: PointerEvent) {
      if (drag!.mode === "marquee") {
        setDraft(null);
        setDrag(null);
        return;
      }
      if (drag!.mode === "draw") {
        const pos = relPos(e.clientX, e.clientY);
        const x = Math.min(drag!.startX, pos.x);
        const y = Math.min(drag!.startY, pos.y);
        const w = Math.abs(pos.x - drag!.startX);
        const h = Math.abs(pos.y - drag!.startY);
        if (ANNOTATION_TOOLS.includes(tool)) {
          snapshot();
          const id = uid();
          const from = { x: drag!.startX, y: drag!.startY };
          const to = { x: pos.x, y: pos.y };
          if (tool === "arrow") {
            // An arrow is drawn tail-to-head, so which corner you started
            // from is the whole meaning — it can't be normalized into a box.
            if (Math.hypot(to.x - from.x, to.y - from.y) > 0.02) {
              setShapes((prev) => [
                ...prev,
                {
                  id,
                  kind: "arrow",
                  annotation: true,
                  points: [from, to],
                  x,
                  y,
                  w,
                  h,
                  color: annotationColor,
                },
              ]);
              setSelectedIds(new Set([id]));
            }
          } else if (tool === "star") {
            // A click with no drag still gives a usable star.
            const size = Math.max(w, h) > 0.02 ? Math.max(w, h) : 0.07;
            setShapes((prev) => [
              ...prev,
              {
                id,
                kind: "star",
                annotation: true,
                x: clamp(Math.min(from.x, to.x), 0, 1 - size),
                y: clamp(Math.min(from.y, to.y), 0, 1 - size),
                w: size,
                h: size,
                color: annotationColor,
              },
            ]);
            setSelectedIds(new Set([id]));
          } else {
            const onReveal = tool === "explain";
            const text = prompt(
              onReveal
                ? "Explanation to show once the answer is revealed:"
                : "Note to show on the image:"
            )?.trim();
            if (text) {
              setShapes((prev) => [
                ...prev,
                {
                  id,
                  kind: "note",
                  annotation: true,
                  onReveal: onReveal || undefined,
                  label: text,
                  x: Math.min(from.x, to.x),
                  y: Math.min(from.y, to.y),
                  // A click without a drag still gives a box worth reading:
                  // wider for an explanation, which is usually a sentence.
                  w: Math.max(w, onReveal ? 0.34 : 0.18),
                  h: Math.max(h, onReveal ? 0.12 : 0.07),
                  // Amber by default, matching how it's marked in the list:
                  // an explanation is a different thing from a label.
                  color: onReveal ? EXPLAIN_COLOR : annotationColor,
                },
              ]);
              setSelectedIds(new Set([id]));
            }
          }
          setDraft(null);
          setDrag(null);
          return;
        }
        if (w > 0.01 && h > 0.01) {
          snapshot();
          const id = uid();
          let label = "";
          let textPrompt: boolean | undefined;
          if (tool === "textbox") {
            const asked = prompt(
              'Question to show on this box (e.g. "What is the coracoid process?"):'
            );
            if (asked === null) {
              setDraft(null);
              setDrag(null);
              return;
            }
            label = asked.trim();
            textPrompt = true;
          }
          setShapes((prev) => [
            ...prev,
            {
              id,
              kind: tool === "ellipse" ? "ellipse" : ("rect" as ShapeKind),
              x,
              y,
              w,
              h,
              // A cover is opaque by default: a half-see-through spoiler is
              // still a spoiler.
              color: tool === "cover" ? COVER_COLOR : defaultColor,
              opacity: tool === "cover" ? 1 : defaultOpacity,
              cover: tool === "cover" ? true : undefined,
              label,
              textPrompt,
            },
          ]);
          setSelectedIds(new Set([id]));
        }
        setDraft(null);
      }
      setDrag(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  async function handleSave() {
    if (!user || !deckId) return;
    if (!title.trim()) {
      alert("Give this occlusion sheet a title first.");
      return;
    }
    if (buildUnits(shapes).length === 0) {
      alert(
        shapes.length === 0
          ? "Draw at least one mask over something you want to hide."
          : "Nothing on this sheet is asked as a question. Add at least one mask — covers, arrows, stars and notes are never questions."
      );
      return;
    }
    setSaving(true);
    try {
      if (isEditing && sheetId) {
        await updateOcclusionSheet(user.uid, deckId, sheetId, {
          title: title.trim(),
          shapes,
          revealMode,
        });
      } else {
        if (!file) {
          alert("Choose or paste an image first.");
          setSaving(false);
          return;
        }
        const { path, url } = await uploadOcclusionImage(user.uid, deckId, file);
        await createOcclusionSheet(user.uid, deckId, {
          title: title.trim(),
          imagePath: path,
          imageUrl: url,
          imageWidth: imgDims.width,
          imageHeight: imgDims.height,
          shapes,
          revealMode,
        });
      }
      goBack();
    } finally {
      setSaving(false);
    }
  }

  // Sequential group badges for the sidebar (A, B, C…).
  const groupBadges = new Map<string, string>();
  for (const s of shapes) {
    if (s.groupId && !groupBadges.has(s.groupId)) {
      groupBadges.set(s.groupId, String.fromCharCode(65 + groupBadges.size));
    }
  }

  const selectedShapes = shapes.filter((s) => selectedIds.has(s.id));
  const cursorClass =
    tool === "select" ? "cursor-default" : "cursor-crosshair";

  return (
    <Layout>
      <button
        onClick={goBack}
        className="mb-4 flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} /> {returnTo ? "Back to notes" : "Back to deck"}
      </button>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Sheet title, e.g. Brachial plexus diagram"
            className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />

          {loading ? (
            <div className="py-20 text-center text-slate-400">Loading…</div>
          ) : !imgSrc ? (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 py-20 text-slate-500 transition hover:border-indigo-400 hover:bg-indigo-50">
              <span className="font-medium">Click to choose an image — or just paste one (⌘V)</span>
              <span className="text-xs">Lecture slide, diagram, or screenshot</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              />
            </label>
          ) : (
            <>
              {/* toolbar */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="flex overflow-hidden rounded-lg border border-slate-200">
                  {(
                    [
                      ["select", MousePointer2, "Select / move"],
                      ["rect", Square, "Rectangle"],
                      ["ellipse", Circle, "Ellipse"],
                      ["polygon", Pentagon, "Polygon (click points, click first point or press Enter to close)"],
                      ["textbox", Type, "Text box — hides what's behind it and shows a question on the box (e.g. \"What is the coracoid process?\")"],
                      ["cover", EyeOff, "Cover — hides something for good. Never revealed, never asked. For the spoiler printed on the slide."],
                    ] as const
                  ).map(([t, Icon, tip]) => (
                    <button
                      key={t}
                      onClick={() => {
                        setTool(t);
                        setPolyDraft([]);
                      }}
                      title={tip}
                      className={`flex h-9 w-9 items-center justify-center transition ${
                        tool === t
                          ? "bg-indigo-600 text-white"
                          : "bg-white text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      <Icon size={16} />
                    </button>
                  ))}
                </div>

                <div className="flex overflow-hidden rounded-lg border border-rose-200">
                  {(
                    [
                      ["note", MessageSquare, "Note — plain text on the image, never asked as a question"],
                      ["arrow", ArrowUpRight, "Arrow — drag from the tail to whatever you're pointing at"],
                      ["star", Star, "Star — mark something worth noticing"],
                      ["explain", Lightbulb, "Explanation — text that appears only once the answer is revealed. Link it to particular masks to show it on just those cards."],
                    ] as const
                  ).map(([t, Icon, tip]) => (
                    <button
                      key={t}
                      onClick={() => {
                        setTool(t);
                        setPolyDraft([]);
                      }}
                      title={tip}
                      className={`flex h-9 w-9 items-center justify-center transition ${
                        tool === t
                          ? "bg-rose-600 text-white"
                          : "bg-white text-rose-500 hover:bg-rose-50"
                      }`}
                    >
                      <Icon size={16} />
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1">
                  {MASK_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => applyColor(c)}
                      title={
                        ANNOTATION_TOOLS.includes(tool)
                          ? "Annotation colour"
                          : "Mask colour (applies to the selection and to new masks)"
                      }
                      className="h-6 w-6 rounded-full border-2"
                      style={{
                        backgroundColor: c,
                        borderColor:
                          (selectedShapes[0]
                            ? shapeColor(selectedShapes[0])
                            : ANNOTATION_TOOLS.includes(tool)
                              ? annotationColor
                              : defaultColor) === c
                            ? "#1e293b"
                            : "transparent",
                      }}
                    />
                  ))}
                </div>

                <label className="flex items-center gap-1.5 text-xs text-slate-500">
                  Opacity
                  <input
                    type="range"
                    min={20}
                    max={100}
                    value={Math.round(
                      (selectedShapes[0]
                        ? shapeOpacity(selectedShapes[0])
                        : defaultOpacity) * 100
                    )}
                    onChange={(e) => applyOpacity(Number(e.target.value) / 100)}
                    className="w-20"
                  />
                </label>

                <div className="ml-auto flex gap-1">
                  <button
                    onClick={undo}
                    disabled={!canUndo}
                    title="Undo (⌘Z)"
                    className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <Undo2 size={15} />
                  </button>
                  <button
                    onClick={redo}
                    disabled={!canRedo}
                    title="Redo (⇧⌘Z)"
                    className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <Redo2 size={15} />
                  </button>
                  <button
                    onClick={duplicateSelected}
                    disabled={!selectedIds.size}
                    title="Duplicate selection (⌘D)"
                    className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <Copy size={15} />
                  </button>
                  <button
                    onClick={groupSelected}
                    disabled={selectedIds.size < 2}
                    title="Group selection — grouped masks reveal together as one card"
                    className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <Group size={15} />
                  </button>
                  <button
                    onClick={ungroupSelected}
                    disabled={!selectedShapes.some((s) => s.groupId)}
                    title="Ungroup selection"
                    className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
                  >
                    <Ungroup size={15} />
                  </button>
                  <button
                    onClick={deleteSelected}
                    disabled={!selectedIds.size}
                    title="Delete selection (⌫)"
                    className="rounded-lg border border-slate-200 p-2 text-red-400 hover:bg-red-50 disabled:opacity-40"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <div
                ref={containerRef}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={
                  tool === "polygon" && polyDraft.length
                    ? (e) => setPolyHover(relPos(e.clientX, e.clientY))
                    : undefined
                }
                onDoubleClick={tool === "polygon" ? commitPolygon : undefined}
                className={`relative w-full touch-none select-none overflow-hidden rounded-lg border border-slate-200 ${cursorClass}`}
              >
                <img
                  src={imgSrc}
                  draggable={false}
                  onLoad={(e) => {
                    if (!isEditing) {
                      setImgDims({
                        width: e.currentTarget.naturalWidth,
                        height: e.currentTarget.naturalHeight,
                      });
                    }
                  }}
                  className="block h-auto w-full select-none"
                  alt=""
                />

                <svg
                  className="absolute inset-0 h-full w-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                >
                  {shapes.map((s) => {
                    const selected = selectedIds.has(s.id);
                    if (isAnnotation(s)) {
                      return (
                        <EditorAnnotation
                          key={s.id}
                          shape={s}
                          selected={selected}
                          onPointerDown={(e) => handleShapePointerDown(e, s)}
                        />
                      );
                    }
                    // While attaching, the masks this one already follows
                    // are ringed, so the set you're building is visible on
                    // the image rather than only in the sidebar.
                    const attached =
                      linking !== null &&
                      (shapes
                        .find((x) => x.id === linking)
                        ?.showsWith?.includes(s.id) ??
                        false);
                    const common = {
                      fill: shapeColor(s),
                      fillOpacity:
                        shapeOpacity(s) *
                        (selected ? 0.85 : isCompanion(s) ? 0.6 : 1),
                      stroke: attached
                        ? "#4f46e5"
                        : selected
                          ? "#1e293b"
                          : isCompanion(s)
                            ? "#4f46e5"
                            : "rgba(255,255,255,0.7)",
                      strokeDasharray: isCompanion(s) && !attached ? "5 3" : undefined,
                      strokeWidth: attached ? 3 : selected ? 2 : 1,
                      vectorEffect: "non-scaling-stroke" as const,
                      style: { pointerEvents: "auto" as const, cursor: "move" },
                      onPointerDown: (e: React.PointerEvent) =>
                        handleShapePointerDown(e, s),
                    };
                    const kind = shapeKind(s);
                    if (kind === "ellipse") {
                      return (
                        <ellipse
                          key={s.id}
                          cx={(s.x + s.w / 2) * 100}
                          cy={(s.y + s.h / 2) * 100}
                          rx={(s.w / 2) * 100}
                          ry={(s.h / 2) * 100}
                          {...common}
                        />
                      );
                    }
                    if (kind === "polygon" && s.points) {
                      return (
                        <polygon
                          key={s.id}
                          points={s.points
                            .map((p) => `${p.x * 100},${p.y * 100}`)
                            .join(" ")}
                          {...common}
                        />
                      );
                    }
                    return (
                      <rect
                        key={s.id}
                        x={s.x * 100}
                        y={s.y * 100}
                        width={s.w * 100}
                        height={s.h * 100}
                        {...common}
                      />
                    );
                  })}

                  {/* drafts */}
                  {draft && (tool === "rect" || tool === "textbox" || tool === "cover") && (
                    <rect
                      x={draft.x * 100}
                      y={draft.y * 100}
                      width={draft.w * 100}
                      height={draft.h * 100}
                      fill={tool === "cover" ? COVER_COLOR : defaultColor}
                      fillOpacity={0.35}
                      stroke={tool === "cover" ? COVER_COLOR : defaultColor}
                      strokeDasharray="4 3"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {draft && tool === "ellipse" && (
                    <ellipse
                      cx={(draft.x + draft.w / 2) * 100}
                      cy={(draft.y + draft.h / 2) * 100}
                      rx={(draft.w / 2) * 100}
                      ry={(draft.h / 2) * 100}
                      fill={defaultColor}
                      fillOpacity={0.35}
                      stroke={defaultColor}
                      strokeDasharray="4 3"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {draft && drag?.mode === "marquee" && (
                    <rect
                      x={draft.x * 100}
                      y={draft.y * 100}
                      width={draft.w * 100}
                      height={draft.h * 100}
                      fill="#6366f1"
                      fillOpacity={0.12}
                      stroke="#6366f1"
                      strokeWidth={1}
                      strokeDasharray="3 2"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {draft && tool === "arrow" && drag?.mode === "draw" && (
                    <line
                      x1={drag.startX * 100}
                      y1={drag.startY * 100}
                      x2={(drag.startX === draft.x ? draft.x + draft.w : draft.x) * 100}
                      y2={(drag.startY === draft.y ? draft.y + draft.h : draft.y) * 100}
                      stroke={annotationColor}
                      strokeWidth={3}
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {draft && (tool === "star" || tool === "note") && (
                    <rect
                      x={draft.x * 100}
                      y={draft.y * 100}
                      width={draft.w * 100}
                      height={draft.h * 100}
                      fill={annotationColor}
                      fillOpacity={0.2}
                      stroke={annotationColor}
                      strokeDasharray="4 3"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {polyDraft.length > 0 && (
                    <polyline
                      points={[...polyDraft, ...(polyHover ? [polyHover] : [])]
                        .map((p) => `${p.x * 100},${p.y * 100}`)
                        .join(" ")}
                      fill={defaultColor}
                      fillOpacity={0.25}
                      stroke={defaultColor}
                      strokeWidth={2}
                      strokeDasharray="4 3"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>

                {shapes
                  .filter((s) => shapeKind(s) === "note" && s.label)
                  .map((s) => (
                    <NoteBox
                      key={`note-${s.id}`}
                      shape={s}
                      containerWidth={canvasSize.width}
                      containerHeight={canvasSize.height}
                      selected={selectedIds.has(s.id)}
                      onPointerDown={(e) => handleShapePointerDown(e, s)}
                    />
                  ))}

                {/* mask labels — annotations carry their own */}
                {shapes.map(
                  (s) =>
                    s.label &&
                    !isAnnotation(s) && (
                      <span
                        key={`lbl-${s.id}`}
                        className="pointer-events-none absolute flex items-center justify-center overflow-hidden px-1 text-center text-[10px] font-medium text-white"
                        style={{
                          left: `${s.x * 100}%`,
                          top: `${s.y * 100}%`,
                          width: `${s.w * 100}%`,
                          height: `${s.h * 100}%`,
                        }}
                      >
                        {s.label}
                      </span>
                    )
                )}

                {/* resize handles for single selection */}
                {selectedShapes.length === 1 &&
                  (() => {
                    const s = selectedShapes[0];
                    if (shapeKind(s) === "polygon" && s.points) {
                      return s.points.map((p, i) => (
                        <div
                          key={`v-${i}`}
                          onPointerDown={(e) => handleVertexPointerDown(e, s, i)}
                          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white bg-slate-800"
                          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                        />
                      ));
                    }
                    // Three handles: the right edge for width, the bottom
                    // edge for height, the corner for both. A note you can
                    // only resize diagonally is a note you can't make wide
                    // and short.
                    return (
                      <>
                        <div
                          onPointerDown={(e) => handleResizePointerDown(e, s, "x")}
                          title="Drag to change the width"
                          className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-white bg-slate-500"
                          style={{
                            left: `${(s.x + s.w) * 100}%`,
                            top: `${(s.y + s.h / 2) * 100}%`,
                          }}
                        />
                        <div
                          onPointerDown={(e) => handleResizePointerDown(e, s, "y")}
                          title="Drag to change the height"
                          className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize rounded-full border-2 border-white bg-slate-500"
                          style={{
                            left: `${(s.x + s.w / 2) * 100}%`,
                            top: `${(s.y + s.h) * 100}%`,
                          }}
                        />
                        <div
                          onPointerDown={(e) => handleResizePointerDown(e, s, "both")}
                          title="Drag to resize"
                          className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-full border-2 border-white bg-slate-800"
                          style={{
                            left: `${(s.x + s.w) * 100}%`,
                            top: `${(s.y + s.h) * 100}%`,
                          }}
                        />
                      </>
                    );
                  })()}

                {/* polygon draft points */}
                {polyDraft.map((p, i) => (
                  <div
                    key={`pd-${i}`}
                    className={`pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white ${
                      i === 0 ? "bg-amber-500" : "bg-indigo-600"
                    }`}
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                  />
                ))}
              </div>

              {linking && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                  <Link2 size={14} className="shrink-0" />
                  <span className="min-w-0 flex-1">
                    Click the masks that this one should appear with. It stays
                    off every other card, and is never asked on its own.
                    {(() => {
                      const n = shapes.find((x) => x.id === linking)?.showsWith?.length ?? 0;
                      return n ? ` Attached to ${n} so far.` : "";
                    })()}
                  </span>
                  <button
                    onClick={() => setLinking(null)}
                    className="shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 font-semibold text-white hover:bg-indigo-700"
                  >
                    Done
                  </button>
                </div>
              )}

              <p className="mt-2 text-xs text-slate-400">
                {tool === "polygon"
                  ? "Click each corner. Click the first point again (or press Enter) to close."
                  : tool === "select"
                    ? "Drag on empty space to lasso several masks at once, then group them. Shift-click to add one."
                    : tool === "textbox"
                      ? "Drag a box, then type the question it should ask. Click an existing mask to give it one."
                      : tool === "arrow"
                        ? "Drag from the tail to whatever you're pointing at. Arrows are never asked as questions."
                        : tool === "star"
                          ? "Click or drag to place a star. Stars are never asked as questions."
                          : tool === "note"
                            ? "Drag a box and type your note. The text wraps and shrinks to fit — select it and drag the edge handles to resize."
                            : tool === "explain"
                              ? "Drag a box and type the explanation. It stays hidden until the answer is revealed — link it to a mask to show it on just that card. The text shrinks to fit; drag the handles to resize the box."
                              : tool === "cover"
                              ? "Drag over anything that shouldn't be seen. Covers stay on for every card and are never asked."
                              : "Drag on the image to draw. Switch to the arrow tool to move/resize."}
              </p>

              {!isEditing && (
                <button
                  onClick={() => {
                    setImgSrc(null);
                    setFile(null);
                    setShapes([]);
                    setSelectedIds(new Set());
                  }}
                  className="mt-1 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
                >
                  <Undo2 size={12} /> Choose a different image
                </button>
              )}
            </>
          )}
        </div>

        {/* sidebar */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-2 text-sm font-bold text-slate-700">
              Shapes ({shapes.length})
              <span className="ml-1 font-normal text-slate-400">
                · {buildUnits(shapes).length} card
                {buildUnits(shapes).length === 1 ? "" : "s"}
                {shapes.some((s) => !isCardShape(s)) &&
                  ` · ${shapes.filter((s) => !isCardShape(s)).length} never asked`}
              </span>
            </h3>
            {shapes.length === 0 ? (
              <p className="text-xs text-slate-400">
                Nothing here yet — draw a mask on the image.
              </p>
            ) : (
              <ul className="max-h-96 space-y-2 overflow-y-auto">
                {shapes.map((s, i) => (
                  <li
                    key={s.id}
                    onClick={(e) => selectOnly(s.id, e.shiftKey)}
                    className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-sm transition cursor-pointer ${
                      selectedIds.has(s.id)
                        ? "border-indigo-400 bg-indigo-50"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: shapeColor(s) }}
                    />
                    <span className="text-xs text-slate-400">{i + 1}</span>
                    {isCover(s) && (
                      <span className="shrink-0 rounded bg-slate-800 px-1 text-[10px] font-bold text-white">
                        cover
                      </span>
                    )}
                    {isCompanion(s) && (
                      <span
                        className="shrink-0 rounded bg-indigo-100 px-1 text-[10px] font-bold text-indigo-700"
                        title={`Only covered while ${s.showsWith!.length} particular mask${
                          s.showsWith!.length === 1 ? " is" : "s are"
                        } being asked`}
                      >
                        with {s.showsWith!.length}
                      </span>
                    )}
                    {isAnnotation(s) && (
                      <span
                        className={`shrink-0 rounded px-1 text-[10px] font-bold ${
                          s.onReveal
                            ? "bg-amber-100 text-amber-700"
                            : "bg-rose-100 text-rose-600"
                        }`}
                      >
                        {s.onReveal ? "answer" : "mark"}
                      </span>
                    )}
                    {s.groupId && (
                      <span className="rounded bg-slate-200 px-1 text-[10px] font-bold text-slate-600">
                        {groupBadges.get(s.groupId)}
                      </span>
                    )}
                    <input
                      value={s.label ?? ""}
                      onChange={(e) => updateLabel(s.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Label (optional)"
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                    />
                    {!isCover(s) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setLinking(linking === s.id ? null : s.id);
                          setSelectedIds(new Set([s.id]));
                        }}
                        title={
                          isCompanion(s)
                            ? `Only shown on ${s.showsWith!.length} card${
                                s.showsWith!.length === 1 ? "" : "s"
                              } — click to change which`
                            : isAnnotation(s)
                              ? "Only show this on certain cards"
                              : "Only show this mask on certain cards"
                        }
                        className={`shrink-0 ${
                          linking === s.id
                            ? "text-indigo-600"
                            : isCompanion(s)
                              ? "text-indigo-500"
                              : "text-slate-300 hover:text-slate-600"
                        }`}
                      >
                        <Link2 size={14} />
                      </button>
                    )}
                    {isAnnotation(s) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          snapshot();
                          setShapes((prev) =>
                            prev.map((x) =>
                              x.id === s.id
                                ? { ...x, onReveal: x.onReveal ? undefined : true }
                                : x
                            )
                          );
                        }}
                        title={
                          s.onReveal
                            ? "Only shown once the answer is revealed"
                            : "Shown on both sides — click to hold it back until the answer"
                        }
                        className={`shrink-0 ${
                          s.onReveal ? "text-amber-500" : "text-slate-300 hover:text-slate-600"
                        }`}
                      >
                        <Lightbulb size={14} />
                      </button>
                    )}
                    {!isAnnotation(s) && !isCompanion(s) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          snapshot();
                          setShapes((prev) =>
                            prev.map((x) =>
                              x.id === s.id
                                ? {
                                    ...x,
                                    cover: isCover(x) ? undefined : true,
                                    color: isCover(x) ? defaultColor : COVER_COLOR,
                                    opacity: isCover(x) ? defaultOpacity : 1,
                                  }
                                : x
                            )
                          );
                        }}
                        title={
                          isCover(s)
                            ? "Make this a question again"
                            : "Never reveal this — hide it on every card"
                        }
                        className={`shrink-0 ${
                          isCover(s)
                            ? "text-slate-700"
                            : "text-slate-300 hover:text-slate-600"
                        }`}
                      >
                        {isCover(s) ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        snapshot();
                        setShapes((prev) => prev.filter((x) => x.id !== s.id));
                      }}
                      className="text-slate-300 hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {groupBadges.size > 0 && (
              <p className="mt-2 text-[11px] text-slate-400">
                Masks sharing a letter badge are grouped: they hide and reveal
                together as one card.
              </p>
            )}
          </div>

          <div className="mb-3">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              How it asks
            </p>
            <div className="space-y-1.5">
              {(
                [
                  [
                    "hideAll",
                    "Hide all, ask one",
                    "Everything is covered and one mask is the question. Harder — the other labels can't help you.",
                  ],
                  [
                    "hideOne",
                    "Show all, hide one",
                    "Only the mask being asked is covered. Easier — the structures around it give you context.",
                  ],
                ] as const
              ).map(([value, label, desc]) => (
                <label
                  key={value}
                  className={`block cursor-pointer rounded-lg border p-2.5 text-xs transition ${
                    revealMode === value
                      ? "border-indigo-400 bg-indigo-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span className="flex items-center gap-2 font-semibold text-slate-800">
                    <input
                      type="radio"
                      checked={revealMode === value}
                      onChange={() => setRevealMode(value)}
                    />
                    {label}
                  </span>
                  <span className="mt-1 block leading-snug text-slate-500">
                    {desc}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
              You can still switch this for a single session while studying.
            </p>
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !imgSrc}
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : isEditing ? "Save changes" : "Create occlusion sheet"}
          </button>
        </div>
      </div>
    </Layout>
  );
}
