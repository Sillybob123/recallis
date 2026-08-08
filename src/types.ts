export interface Deck {
  id: string;
  name: string;
  subject?: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  /** set when the deck is in the trash; hard-deleted 30 days later */
  deletedAt?: number | null;
  /** removed from Quizlet's lists but still scheduled in Anki */
  hiddenInQuizlet?: boolean;
  /** removed from Anki's lists but still available to cram in Quizlet */
  hiddenInAnki?: boolean;
  cardCount?: number;
  occlusionCount?: number;
}

export type CardType = "basic" | "cloze";

export interface BasicCardData {
  type: "basic";
  front: string;
  back: string;
}

export interface ClozeCardData {
  type: "cloze";
  text: string;
  extra?: string;
}

export type CardData = BasicCardData | ClozeCardData;

export interface Card {
  id: string;
  createdAt: number;
  updatedAt: number;
  stats: { correct: number; incorrect: number };
  data: CardData;
}

export type ShapeKind = "rect" | "ellipse" | "polygon";

export interface OcclusionShape {
  id: string;
  /** defaults to "rect" for sheets created before shape kinds existed */
  kind?: ShapeKind;
  /** normalized 0-1 bounding box relative to image size (ellipse = inscribed) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** polygon only: normalized vertices; x/y/w/h stay in sync as the bounds */
  points?: { x: number; y: number }[];
  label?: string;
  /** mask fill color, defaults to the app mask blue */
  color?: string;
  /** 0-1 fill opacity, defaults to 1 */
  opacity?: number;
  /** shapes sharing a groupId are hidden/revealed together as one card */
  groupId?: string;
}

export interface OcclusionSheet {
  /**
   * True when imagePath points at a file owned by something else (a note's
   * slide). Deleting the sheet or its deck must not remove that file.
   */
  linkedImage?: boolean;
  id: string;
  title: string;
  imagePath: string;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  shapes: OcclusionShape[];
  createdAt: number;
  updatedAt: number;
}

export type OcclusionMode = "hideOne" | "hideAll";

export interface NoteSlide {
  id: string;
  imagePath: string;
  imageUrl: string;
  /** per-slide lecture notes (sanitized HTML) */
  note: string;
}

export interface Note {
  id: string;
  title: string;
  /** class this lecture belongs to, e.g. "Anatomy" */
  className: string;
  /** main rich-text body (sanitized HTML) */
  content: string;
  slides: NoteSlide[];
  /** how many flashcards have been made from this note */
  cardsMade?: number;
  createdAt: number;
  updatedAt: number;
}
