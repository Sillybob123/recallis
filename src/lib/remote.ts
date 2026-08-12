// Bluetooth study remotes.
//
// What people actually hold falls into three families, and they behave very
// differently from a web page's point of view:
//
//  1. Keyboard remotes. Presentation clickers (Logitech R400 and friends)
//     send PageDown/PageUp; the 8BitDo Zero 2 in keyboard mode sends plain
//     letters — C,D,E,F for the d-pad and G,H,I,J,K,M,N,O for the buttons,
//     which is why nothing "just works" until you know that. These arrive as
//     ordinary keydown events, so they need no permission and no driver.
//
//  2. Gamepad remotes. The same 8BitDo in its default mode, and most cheap
//     controllers, report as gamepads. A browser can read those directly
//     through the Gamepad API — which means none of the Joy2Key or
//     Karabiner remapping every desktop-Anki guide walks you through is
//     needed here.
//
//  3. Camera-shutter remotes (AB Shutter 3 and its clones). These send
//     volume keys, which the operating system swallows before any page sees
//     them. No web page can read those, and pretending otherwise would be
//     worse than saying so.
//
// Everything here is pure: what a key or button means, what the presets are,
// and how to serialise a binding. The polling lives in useRemote.ts.

export type RemoteAction =
  | "advance"
  | "fail"
  | "again"
  | "hard"
  | "good"
  | "easy"
  | "undo"
  | "star"
  | "scrollUp"
  | "scrollDown";

export const REMOTE_ACTIONS: { id: RemoteAction; label: string; hint: string }[] = [
  {
    id: "advance",
    label: "Show answer / Good",
    hint: "The one button you press most: reveals the card, then grades it Good.",
  },
  {
    id: "fail",
    label: "Show answer / Again",
    hint: "Reveals the card, then grades it Again.",
  },
  { id: "again", label: "Again", hint: "Grade 1 — only once the answer is showing." },
  { id: "hard", label: "Hard", hint: "Grade 2." },
  { id: "good", label: "Good", hint: "Grade 3." },
  { id: "easy", label: "Easy", hint: "Grade 4." },
  { id: "undo", label: "Undo", hint: "Take back the last answer." },
  { id: "star", label: "Star", hint: "Mark the card for extra review." },
  { id: "scrollUp", label: "Scroll up", hint: "For cards taller than the screen." },
  { id: "scrollDown", label: "Scroll down", hint: "" },
];

/** A key binding stores event.key, lowercased for letters. */
export interface RemoteMapping {
  keys: Partial<Record<RemoteAction, string[]>>;
  /** gamepad button indices, in the standard mapping */
  buttons: Partial<Record<RemoteAction, number[]>>;
  /** whether to read connected gamepads at all */
  gamepad: boolean;
}

/**
 * Works out of the box for a presentation clicker and for anything sending
 * the obvious keys. Grade digits match Anki's own 1–4, which its users
 * already have in their fingers.
 */
export const DEFAULT_MAPPING: RemoteMapping = {
  keys: {
    advance: [" ", "enter", "pagedown", "arrowright"],
    fail: ["x", "arrowleft"],
    again: ["1"],
    hard: ["2"],
    good: ["3"],
    easy: ["4"],
    undo: ["pageup", "backspace"],
    star: ["s"],
    scrollUp: ["arrowup"],
    scrollDown: ["arrowdown"],
  },
  buttons: {
    // The standard gamepad layout: 0 is the bottom face button, 1 the right,
    // 2 the left, 3 the top; 4/5 are the shoulders; 12–15 the d-pad.
    advance: [0, 5],
    fail: [1],
    hard: [2],
    easy: [3],
    undo: [4, 8],
    star: [9],
    scrollUp: [12],
    scrollDown: [13],
  },
  gamepad: true,
};

/**
 * Presets for the remotes people actually buy.
 *
 * The 8BitDo one is the reason this file exists: in keyboard mode it sends
 * letters with no relationship to what the buttons say, so a mapping that
 * looks arbitrary written down is exactly right in the hand.
 */
export const REMOTE_PRESETS: { id: string; name: string; note: string; mapping: RemoteMapping }[] = [
  {
    id: "default",
    name: "Standard",
    note: "Space, Enter, arrows, PageUp/PageDown, and 1–4 for grading. Works with most clickers.",
    mapping: DEFAULT_MAPPING,
  },
  {
    id: "8bitdo",
    name: "8BitDo Zero 2 — keyboard mode",
    note: "Hold R + Start for 5 seconds to put it in keyboard mode, then pair it. Its buttons send letters, which is why the mapping looks odd written down.",
    mapping: {
      ...DEFAULT_MAPPING,
      keys: {
        // Up=C Down=D Left=E Right=F A=G X=H Y=I B=J L=K R=M Select=N Start=O
        advance: [" ", "enter", "m", "g"], // R and A
        fail: ["j"], // B
        again: ["j", "1"],
        hard: ["i", "2"], // Y
        good: ["g", "3"], // A
        easy: ["h", "4"], // X
        undo: ["k", "pageup"], // L
        star: ["n", "s"], // Select
        scrollUp: ["c", "arrowup"],
        scrollDown: ["d", "arrowdown"],
      },
    },
  },
  {
    id: "clicker",
    name: "Presentation clicker",
    note: "The forward/back buttons on a Logitech, Kensington or similar pointer.",
    mapping: {
      ...DEFAULT_MAPPING,
      keys: {
        ...DEFAULT_MAPPING.keys,
        // Not the down arrow: clickers that send it are usually scrolling,
        // and binding it here would silently kill scrolling on long cards.
        advance: [" ", "enter", "pagedown", "arrowright"],
        undo: ["pageup", "arrowleft", "backspace"],
        fail: ["x", "b", "escape"],
      },
    },
  },
];

/**
 * The stored form of a key. Letters are lowercased so Caps Lock or a remote
 * that sends shifted characters still matches; everything else keeps the
 * name the browser gives it.
 */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key.toLowerCase();
}

/** A key as it should be shown to a person. */
export function keyLabel(key: string): string {
  if (key === " ") return "Space";
  const named: Record<string, string> = {
    enter: "Enter",
    pagedown: "Page Down",
    pageup: "Page Up",
    arrowright: "→",
    arrowleft: "←",
    arrowup: "↑",
    arrowdown: "↓",
    backspace: "Backspace",
    escape: "Esc",
    tab: "Tab",
  };
  return named[key] ?? key.toUpperCase();
}

export function buttonLabel(index: number): string {
  const named: Record<number, string> = {
    0: "A / bottom",
    1: "B / right",
    2: "X / left",
    3: "Y / top",
    4: "L shoulder",
    5: "R shoulder",
    6: "L trigger",
    7: "R trigger",
    8: "Select",
    9: "Start",
    12: "D-pad ↑",
    13: "D-pad ↓",
    14: "D-pad ←",
    15: "D-pad →",
  };
  return named[index] ?? `Button ${index}`;
}

/**
 * Which action a key means, or null.
 *
 * Order matters: the first action in REMOTE_ACTIONS that claims the key
 * wins, so a key bound to two things resolves the same way every time
 * rather than depending on object key order.
 */
export function actionForKey(
  mapping: RemoteMapping,
  key: string
): RemoteAction | null {
  const k = normalizeKey(key);
  for (const { id } of REMOTE_ACTIONS) {
    if (mapping.keys[id]?.includes(k)) return id;
  }
  return null;
}

export function actionForButton(
  mapping: RemoteMapping,
  index: number
): RemoteAction | null {
  for (const { id } of REMOTE_ACTIONS) {
    if (mapping.buttons[id]?.includes(index)) return id;
  }
  return null;
}

/** Binds a key to an action, taking it off whatever else held it. */
export function bindKey(
  mapping: RemoteMapping,
  action: RemoteAction,
  key: string
): RemoteMapping {
  const k = normalizeKey(key);
  const keys: RemoteMapping["keys"] = {};
  for (const [id, list] of Object.entries(mapping.keys)) {
    keys[id as RemoteAction] = list.filter((x) => x !== k);
  }
  keys[action] = [...(keys[action] ?? []), k];
  return { ...mapping, keys };
}

export function bindButton(
  mapping: RemoteMapping,
  action: RemoteAction,
  index: number
): RemoteMapping {
  const buttons: RemoteMapping["buttons"] = {};
  for (const [id, list] of Object.entries(mapping.buttons)) {
    buttons[id as RemoteAction] = list.filter((x) => x !== index);
  }
  buttons[action] = [...(buttons[action] ?? []), index];
  return { ...mapping, buttons };
}

export function clearAction(
  mapping: RemoteMapping,
  action: RemoteAction
): RemoteMapping {
  return {
    ...mapping,
    keys: { ...mapping.keys, [action]: [] },
    buttons: { ...mapping.buttons, [action]: [] },
  };
}

/**
 * Which gamepad buttons changed from up to down between two polls.
 *
 * A gamepad reports state, not events, so a held button reads as pressed on
 * every frame — without this a resting thumb would grade the whole deck.
 */
export function pressedSince(
  previous: readonly boolean[],
  current: readonly boolean[]
): number[] {
  const out: number[] = [];
  for (let i = 0; i < current.length; i++) {
    if (current[i] && !previous[i]) out.push(i);
  }
  return out;
}

/**
 * A remote press must not also do whatever the browser does with that key —
 * Space scrolling the page, Backspace going back — but a key we don't
 * recognise should be left alone.
 */
export function shouldPreventDefault(action: RemoteAction | null): boolean {
  return action !== null;
}

/**
 * The 8BitDo Zero 2 in keyboard mode sends exactly these letters and
 * nothing else — C through O with L missing. Seeing one of them from a
 * device nobody is typing on is a strong enough signal to name the remote.
 */
const EIGHTBITDO_LETTERS = new Set(["c", "d", "e", "f", "g", "h", "i", "j", "k", "m", "n", "o"]);

export interface Detection {
  presetId: string;
  name: string;
  why: string;
}

/**
 * Guesses which remote just sent a key, so that connecting one is a matter
 * of pressing a button rather than knowing what a Zero 2 emits.
 */
export function detectFromKey(key: string): Detection | null {
  const k = normalizeKey(key);
  if (k.length === 1 && EIGHTBITDO_LETTERS.has(k)) {
    return {
      presetId: "8bitdo",
      name: "8BitDo Zero 2 (keyboard mode)",
      why: `It sent the letter ${k.toUpperCase()} — that family of remotes sends letters C to O instead of the keys its buttons are labelled with.`,
    };
  }
  if (k === "pagedown" || k === "pageup") {
    return {
      presetId: "clicker",
      name: "Presentation clicker",
      why: "It sent Page Down/Page Up, which is what a slide pointer sends.",
    };
  }
  if (k === " " || k === "enter" || k.startsWith("arrow")) {
    return {
      presetId: "default",
      name: "Keyboard-style remote",
      why: `It sent ${keyLabel(k)}, which already works.`,
    };
  }
  return null;
}

export function detectFromButton(padId: string): Detection {
  return {
    presetId: "default",
    name: padId || "Controller",
    why: "Your browser sees it as a controller, so it works directly — none of the Joy2Key or Karabiner remapping the desktop Anki guides describe is needed.",
  };
}

/** Keys the operating system takes before a web page ever sees them. */
export const UNREACHABLE_KEYS =
  "Volume up and volume down. Camera-shutter remotes like the AB Shutter 3 send those, and no website can read them — the phone changes its volume instead. Those remotes work in the Anki app but not in a browser.";
