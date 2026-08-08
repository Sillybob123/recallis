import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  GraduationCap,
  ImagePlus,
  Layers,
  Pencil,
  Plus,
  ScanEye,
  Trash2,
  Upload,
} from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Layout } from "../components/Layout";
import { RichText } from "../components/RichText";
import { CardEditorModal } from "../components/CardEditorModal";
import { BulkImportModal } from "../components/BulkImportModal";
import {
  createCard,
  createCardsBulk,
  deleteCard,
  deleteOcclusionSheet,
  getDeck,
  updateCard,
  watchCards,
  watchOcclusions,
} from "../lib/firestore";
import { exportDeckToAnki, downloadBlob } from "../lib/ankiExport";
import type { Card, CardData, Deck, OcclusionSheet } from "../types";
import { stripCloze } from "../lib/cloze";
import { normalizeDeckPath } from "../lib/deckPath";

export function DeckPage() {
  const { deckId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [sheets, setSheets] = useState<OcclusionSheet[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [editingCard, setEditingCard] = useState<Card | undefined>();
  const [showBulk, setShowBulk] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!user || !deckId) return;
    getDeck(user.uid, deckId).then(setDeck);
    const u1 = watchCards(user.uid, deckId, setCards);
    const u2 = watchOcclusions(user.uid, deckId, setSheets);
    return () => {
      u1();
      u2();
    };
  }, [user, deckId]);

  async function handleSaveCard(data: CardData) {
    if (!user || !deckId) return;
    if (editingCard) {
      await updateCard(user.uid, deckId, editingCard.id, data);
    } else {
      await createCard(user.uid, deckId, data);
    }
  }

  async function handleBulkImport(items: CardData[]) {
    if (!user || !deckId) return;
    await createCardsBulk(user.uid, deckId, items);
  }

  async function handleDeleteCard(cardId: string) {
    if (!user || !deckId) return;
    if (confirm("Delete this card?")) {
      await deleteCard(user.uid, deckId, cardId);
    }
  }

  async function handleDeleteSheet(sheet: OcclusionSheet) {
    if (!user || !deckId) return;
    if (confirm(`Delete "${sheet.title}" and all its masks?`)) {
      await deleteOcclusionSheet(
        user.uid,
        deckId,
        sheet.id,
        sheet.imagePath,
        sheet.linkedImage
      );
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const { blob, filename, warnings } = await exportDeckToAnki(
        deck ? normalizeDeckPath(deck.name) : "My Deck",
        cards,
        sheets
      );
      downloadBlob(blob, filename);
      if (warnings.length) {
        alert(warnings.join("\n\n"));
      }
    } catch (err) {
      alert("Export failed: " + (err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const hasContent = cards.length > 0 || sheets.length > 0;

  return (
    <Layout>
      <button
        onClick={() => navigate("/decks")}
        className="mb-4 flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={15} /> All decks
      </button>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {deck ? normalizeDeckPath(deck.name) : "Deck"}
          </h1>
          <p className="text-sm text-slate-500">
            {cards.length} card{cards.length === 1 ? "" : "s"} · {sheets.length} image
            occlusion sheet{sheets.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`study`}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
            title="Study everything together: flashcards, cloze, and image occlusion"
          >
            <GraduationCap size={16} /> Study all
          </Link>
          <Link
            to={`study?only=cards`}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            title="Only flashcards and cloze cards"
          >
            <Layers size={16} /> Cards only
          </Link>
          <Link
            to={`study-occlusion`}
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-900"
            title="Drill only the image occlusion sheets"
          >
            <ScanEye size={16} /> Occlusion only
          </Link>
          <button
            onClick={handleExport}
            disabled={exporting || !hasContent}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <Download size={16} /> {exporting ? "Exporting…" : "Export to Anki"}
          </button>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <button
          onClick={() => {
            setEditingCard(undefined);
            setShowEditor(true);
          }}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Plus size={15} /> Add card
        </button>
        <button
          onClick={() => setShowBulk(true)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Upload size={15} /> Bulk import
        </button>
        <Link
          to={`occlusion/new`}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ImagePlus size={15} /> New image occlusion
        </Link>
      </div>

      {!hasContent && (
        <div className="mb-6 rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <Layers className="mx-auto mb-3 text-slate-300" size={36} />
          <p className="mb-1 font-medium text-slate-700">This deck is empty</p>
          <p className="text-sm text-slate-500">
            Add a card, bulk import, or create an image occlusion sheet to get started.
          </p>
        </div>
      )}

      {sheets.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">
            Image occlusion sheets
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sheets.map((sheet) => (
              <div
                key={sheet.id}
                className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="relative aspect-video w-full overflow-hidden bg-slate-100">
                  <img
                    src={sheet.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-slate-900/0 opacity-0 transition group-hover:bg-slate-900/40 group-hover:opacity-100">
                    <Link
                      to={`occlusion/${sheet.id}/edit`}
                      className="rounded-lg bg-white p-2 text-slate-700 hover:bg-slate-100"
                      title="Edit masks"
                    >
                      <Pencil size={15} />
                    </Link>
                    <button
                      onClick={() => handleDeleteSheet(sheet)}
                      className="rounded-lg bg-white p-2 text-red-500 hover:bg-red-50"
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <div className="p-3">
                  <p className="truncate font-medium text-slate-800">{sheet.title}</p>
                  <p className="text-xs text-slate-400">
                    {sheet.shapes.length} mask{sheet.shapes.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {cards.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-400">
            Cards
          </h2>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {cards.map((card) => (
              <div key={card.id} className="group flex items-start gap-3 p-4">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    card.data.type === "basic"
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-purple-100 text-purple-700"
                  }`}
                >
                  {card.data.type}
                </span>
                <div className="min-w-0 flex-1">
                  {card.data.type === "basic" ? (
                    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-4">
                      <RichText html={card.data.front} className="text-sm text-slate-800" />
                      <RichText html={card.data.back} className="text-sm text-slate-500" />
                    </div>
                  ) : (
                    <RichText
                      html={stripCloze(card.data.text)}
                      className="text-sm text-slate-800"
                    />
                  )}
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={() => {
                      setEditingCard(card);
                      setShowEditor(true);
                    }}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDeleteCard(card.id)}
                    className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {showEditor && (
        <CardEditorModal
          initial={editingCard}
          uid={user?.uid}
          deckId={deckId}
          onSave={handleSaveCard}
          onClose={() => setShowEditor(false)}
        />
      )}
      {showBulk && (
        <BulkImportModal onImport={handleBulkImport} onClose={() => setShowBulk(false)} />
      )}
    </Layout>
  );
}
