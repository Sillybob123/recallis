import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Type,
  Circle,
  Copy,
  Group,
  MousePointer2,
  Pentagon,
  Square,
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
import { DEFAULT_MASK_COLOR, polygonBounds, shapeColor, shapeKind, shapeOpacity, translateShape } from "../lib/shapes";
import type { OcclusionShape, ShapeKind } from "../types";
import { uid } from "../lib/uid";

const MASK_COLORS = [DEFAULT_MASK_COLOR, "#ef4444", "#10b981", "#f59e0b", "#a855f7", "#ec4899", "#334155"];

type Tool = "select" | "rect" | "ellipse" | "polygon" | "textbox";

interface DragState {
  mode: "draw" | "move" | "resize" | "vertex";
  startX: number;
  startY: number;
  /** original shapes at drag start, for move/resize/vertex */
  originals?: Map<string, OcclusionShape>;
  shapeId?: string;
  vertexIndex?: number;
  moved?: boolean;
}

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
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
    if (selectedIds.size < 2) return;
    const gid = uid();
    setShapes((prev) =>
      prev.map((s) => (selectedIds.has(s.id) ? { ...s, groupId: gid } : s))
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
    setDefaultColor(color);
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
    if (tool === "rect" || tool === "ellipse" || tool === "textbox") {
      setSelectedIds(new Set());
      setDrag({ mode: "draw", startX: pos.x, startY: pos.y });
      setDraft({ x: pos.x, y: pos.y, w: 0, h: 0 });
      return;
    }
    // select tool on empty canvas: clear selection
    if (!e.shiftKey) setSelectedIds(new Set());
  }

  function handleShapePointerDown(e: React.PointerEvent, shape: OcclusionShape) {
    if (tool === "polygon") return; // clicks pass through while drawing
    e.stopPropagation();
    // With the text tool active, clicking an existing mask turns it into a
    // text box (or edits the prompt of one that already is).
    if (tool === "textbox") {
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
      if (drag!.mode === "draw") {
        setDraft({
          x: Math.min(drag!.startX, pos.x),
          y: Math.min(drag!.startY, pos.y),
          w: Math.abs(dx),
          h: Math.abs(dy),
        });
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
      if (drag!.mode === "draw") {
        const pos = relPos(e.clientX, e.clientY);
        const x = Math.min(drag!.startX, pos.x);
        const y = Math.min(drag!.startY, pos.y);
        const w = Math.abs(pos.x - drag!.startX);
        const h = Math.abs(pos.y - drag!.startY);
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
    if (shapes.length === 0) {
      alert("Draw at least one mask over something you want to hide.");
      return;
    }
    setSaving(true);
    try {
      if (isEditing && sheetId) {
        await updateOcclusionSheet(user.uid, deckId, sheetId, {
          title: title.trim(),
          shapes,
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

                <div className="flex items-center gap-1">
                  {MASK_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => applyColor(c)}
                      title="Mask color (applies to selection and new masks)"
                      className="h-6 w-6 rounded-full border-2"
                      style={{
                        backgroundColor: c,
                        borderColor:
                          (selectedShapes[0]
                            ? shapeColor(selectedShapes[0])
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

                {/* mask labels */}
                {shapes.map(
                  (s) =>
                    s.label && (
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
                  ? "Click to add points; click the first (amber) point, double-click, or press Enter to close. Esc cancels."
                  : tool === "select"
                  ? "Click to select (shift-click for multiple), drag to move, corner handle to resize."
                  : tool === "textbox"
                  ? "Drag a box over the answer, or click an existing mask to turn it into a text box."
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
