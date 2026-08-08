import type { Card, OcclusionSheet } from "../types";
import { findClozeNumbers, renderClozeAnswer, renderClozeQuestion } from "./cloze";
import { buildUnits, type ShapeUnit } from "./shapes";
import { stripHtml } from "./text";

export type StudyItem =
  | {
      kind: "text";
      key: string;
      cardId: string;
      frontHtml: string;
      backHtml: string;
      backPlain: string;
      /** plain text of the front — used for "answer with term" swapping */
      frontPlain: string;
      isCloze: boolean;
    }
  | {
      kind: "occlusion";
      key: string;
      sheet: OcclusionSheet;
      unit: ShapeUnit;
    };

export function buildTextItems(
  cards: Card[],
  opts: { answerWithTerm?: boolean } = {}
): StudyItem[] {
  const items: StudyItem[] = [];
  for (const card of cards) {
    if (card.data.type === "basic") {
      // "Answer with term" flips the card: the definition becomes the
      // question and the term is what you answer with (Quizlet's toggle).
      const swap = Boolean(opts.answerWithTerm);
      const front = swap ? card.data.back : card.data.front;
      const back = swap ? card.data.front : card.data.back;
      items.push({
        kind: "text",
        key: card.id,
        cardId: card.id,
        frontHtml: front,
        backHtml: back,
        backPlain: stripHtml(back),
        frontPlain: stripHtml(front),
        isCloze: false,
      });
    } else {
      for (const num of findClozeNumbers(card.data.text)) {
        const backHtml =
          renderClozeAnswer(card.data.text, num) +
          (card.data.extra
            ? `<div class="mt-2 text-sm text-slate-500">${card.data.extra}</div>`
            : "");
        items.push({
          kind: "text",
          key: `${card.id}-c${num}`,
          cardId: card.id,
          frontHtml: renderClozeQuestion(card.data.text, num),
          backHtml,
          backPlain: stripHtml(renderClozeAnswer(card.data.text, num)),
          frontPlain: stripHtml(renderClozeQuestion(card.data.text, num)),
          isCloze: true,
        });
      }
    }
  }
  return items;
}

export function buildOcclusionItems(sheets: OcclusionSheet[]): StudyItem[] {
  const items: StudyItem[] = [];
  for (const sheet of sheets) {
    for (const unit of buildUnits(sheet.shapes)) {
      items.push({ kind: "occlusion", key: `${sheet.id}-${unit.key}`, sheet, unit });
    }
  }
  return items;
}

/** The short answer a study item expects (for written/multiple-choice). */
export function itemAnswer(item: StudyItem): string {
  return item.kind === "text" ? item.backPlain : item.unit.label ?? "";
}
