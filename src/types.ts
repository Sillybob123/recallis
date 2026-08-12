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
  /** Anki-style tags, stored normalized (no spaces inside a tag) */
  tags?: string[];
  /** starred in Quizlet mode — pulls the note into extra review */
  starred?: boolean;
  /**
   * Identity of the source note this came from (e.g. "anki:1785861078053").
   * Re-importing the same package matches on this so existing cards are
   * updated rather than duplicated.
   */
  importId?: string;
  createdAt: number;
  updatedAt: number;
  stats: { correct: number; incorrect: number };
  data: CardData;
}

/**
 * The first three cover something up and become a question. The last three
 * are annotations: they mark the image up without ever being asked, so they
 * stay visible on every card.
 */
export type ShapeKind =
  | "rect"
  | "ellipse"
  | "polygon"
  | "note"
  | "arrow"
  | "star";

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
  /** show the label on the covered box as a guessing prompt */
  textPrompt?: boolean;
  /** mask fill color, defaults to the app mask blue */
  color?: string;
  /** 0-1 fill opacity, defaults to 1 */
  opacity?: number;
  /** shapes sharing a groupId are hidden/revealed together as one card */
  groupId?: string;
  /**
   * Marks this as an annotation rather than a mask: always drawn, never
   * hidden, never a card. Stored alongside the kind so that a client too old
   * to know "arrow" still knows not to ask a question about it.
   */
  annotation?: boolean;
  /** annotations only: line thickness as a fraction of the image width */
  weight?: number;
  /**
   * A cover: always painted over, on the question and the answer alike, and
   * never asked. For the spoiler printed on the slide — the label you don't
   * want giving the answer away while you're being asked something else.
   */
  cover?: boolean;
  /**
   * Ids of the masks this one accompanies. A shape with this set is never
   * asked on its own; it is covered only while one of those masks is the
   * question. For the neighbouring label that would give this particular
   * card away, but is fair game on every other card.
   */
  showsWith?: string[];
}

export interface OcclusionSheet {
  /** starred in Quizlet mode — pulls the sheet into extra review */
  starred?: boolean;
  /**
   * How this sheet asks its masks:
   * "hideAll" — everything covered, one mask is the question (harder: no
   *   help from the other labels being visible)
   * "hideOne" — only the asked mask is covered, everything else readable
   *   (easier: the surrounding structures give you context)
   */
  revealMode?: "hideAll" | "hideOne";
  /**
   * True when imagePath points at a file owned by something else (a note's
   * slide). Deleting the sheet or its deck must not remove that file.
   */
  linkedImage?: boolean;
  id: string;
  /** Anki-style tags, as on Card */
  tags?: string[];
  /** source-note identity, as on Card — used to merge re-imports */
  importId?: string;
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
  /** flagged as worth coming back to before an exam */
  important?: boolean;
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
  /** last subdeck cards from this lecture were filed into, e.g. "Thorax" */
  lastSubdeck?: string;
  createdAt: number;
  updatedAt: number;
}
