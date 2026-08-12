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
  MousePointer2,
  Pentagon,
  Square,
  Star,
  Trash2,
  Undo2,
  Ungroup,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Layout } from "../components/Layout";
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
  polygonBounds,
  shapeColor,
  shapeKind,
  shapeOpacity,
  starPoints,
  translateShape,
} from "../lib/shapes";
import type { OcclusionShape, ShapeKind } from "../types";
import { uid } from "../lib/uid";

const MASK_COLORS = [DEFAULT_MASK_COLOR, "#ef4444", "#10b981", "#f59e0b", "#a855f7", "#ec4899", "#334155"];

type Tool =
  | "select"
  | "rect"
  | "ellipse"
  | "polygon"
  | "textbox"
  | "note"
  | "arrow"
  | "star";

/** The tools that mark the image up instead of covering it. */
const ANNOTATION_TOOLS: Tool[] = ["note", "arrow", "star"];

interface DragState {
  mode: "draw" | "move" | "resize" | "vertex" | "marquee";
  startX: number;
  startY: number;
  /** original shapes at drag start, for move/resize/vertex */
  originals?: Map<string, OcclusionShape>;
  shapeId?: string;
  vertexIndex?: number;
  moved?: boolean;
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
  // The drag handlers are bound once per drag, so they read the live shapes
  // through a ref rather than a stale closure.
  const shapesRef = useRef<OcclusionShape[]>([]);
  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  const containerRef = useRef<HTMLDivElement>(null);
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
    setShapes((prev) => prev.filter((s) => !selectedIds.has(s.id)));
    setSelectedIds(new Set());
  }

  function duplicateSelected() {
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
    const gid = uid();
    const inGroup = new Set(maskIds);
    setShapes((prev) =>
      prev.map((s) => (inGroup.has(s.id) ? { ...s, groupId: gid } : s))
    );
  }

  function ungroupSelected() {
    setShapes((prev) =>
      prev.map((s) =>
        selectedIds.has(s.id) ? { ...s, groupId: undefined } : s
      )
    );
  }

  function applyColor(color: string) {
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
    setDefaultOpacity(opacity);
    if (selectedIds.size) {
      setShapes((prev) =>
        prev.map((s) => (selectedIds.has(s.id) ? { ...s, opacity } : s))
      );
    }
  }

  function updateLabel(id: string, label: string) {
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
        setPolyDraft([]);
        setPolyHover(null);
        setSelectedIds(new Set());
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
    // With the text tool active, clicking an existing mask turns it into a
    // text box (or edits the prompt of one that already is).
    if (tool === "textbox" && !isAnnotation(shape)) {
      const asked = prompt(
        "Question to show on this box:",
        shape.textPrompt ? shape.label ?? "" : ""
      );
      if (asked === null) return;
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

  function handleResizePointerDown(e: React.PointerEvent, shape: OcclusionShape) {
    e.stopPropagation();
    const pos = relPos(e.clientX, e.clientY);
    const originals = new Map<string, OcclusionShape>([[shape.id, shape]]);
    setDrag({
      mode: "resize",
      startX: pos.x,
      startY: pos.y,
      originals,
      shapeId: shape.id,
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
        drag!.moved = true;
        setShapes((prev) =>
          prev.map((s) => {
            const orig = drag!.originals!.get(s.id);
            return orig ? translateShape(orig, dx, dy) : s;
          })
        );
      } else if (drag!.mode === "resize" && drag!.originals && drag!.shapeId) {
        const orig = drag!.originals.get(drag!.shapeId)!;
        const nw = clamp(orig.w + dx, 0.015, 1 - orig.x);
        const nh = clamp(orig.h + dy, 0.015, 1 - orig.y);
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
            const text = prompt("Note to show on the image:")?.trim();
            if (text) {
              setShapes((prev) => [
                ...prev,
                {
                  id,
                  kind: "note",
                  annotation: true,
                  label: text,
                  x: Math.min(from.x, to.x),
                  y: Math.min(from.y, to.y),
                  w: Math.max(w, 0.12),
                  h: Math.max(h, 0.05),
                  color: annotationColor,
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
              color: defaultColor,
              opacity: defaultOpacity,
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
          : "This sheet only has annotations on it. Add at least one mask — arrows, stars and notes are never asked as questions."
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
                    const common = {
                      fill: shapeColor(s),
                      fillOpacity: shapeOpacity(s) * (selected ? 0.85 : 1),
                      stroke: selected ? "#1e293b" : "rgba(255,255,255,0.7)",
                      strokeWidth: selected ? 2 : 1,
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
                  {draft && (tool === "rect" || tool === "textbox") && (
                    <rect
                      x={draft.x * 100}
                      y={draft.y * 100}
                      width={draft.w * 100}
                      height={draft.h * 100}
                      fill={defaultColor}
                      fillOpacity={0.35}
                      stroke={defaultColor}
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
                    <span
                      key={`note-${s.id}`}
                      onPointerDown={(e) => handleShapePointerDown(e, s)}
                      className="absolute flex cursor-move items-center rounded-md px-1.5 font-bold leading-tight"
                      style={{
                        left: `${s.x * 100}%`,
                        top: `${s.y * 100}%`,
                        height: `${s.h * 100}%`,
                        maxWidth: `${(1 - s.x) * 100}%`,
                        color: shapeColor(s),
                        background: "rgba(255,255,255,0.92)",
                        border: `${selectedIds.has(s.id) ? 2 : 1}px solid ${shapeColor(s)}`,
                        fontSize: "clamp(9px, 1.5vw, 15px)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.label}
                    </span>
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
                    return (
                      <div
                        onPointerDown={(e) => handleResizePointerDown(e, s)}
                        className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-full border-2 border-white bg-slate-800"
                        style={{
                          left: `${(s.x + s.w) * 100}%`,
                          top: `${(s.y + s.h) * 100}%`,
                        }}
                      />
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
                            ? "Drag a box and type your note. Notes stay visible on every card."
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
              Masks ({shapes.length})
              {buildUnits(shapes).length !== shapes.length && (
                <span className="ml-1 font-normal text-slate-400">
                  · {buildUnits(shapes).length} cards
                </span>
              )}
            </h3>
            {shapes.length === 0 ? (
              <p className="text-xs text-slate-400">
                No masks yet — draw one on the image.
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
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
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
