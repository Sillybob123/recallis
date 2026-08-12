// Reading a study remote while a card is on screen.
//
// Keyboard remotes arrive as ordinary keydown events, so the study page
// handles those itself. This hook is for the other half: gamepad-mode
// remotes, which report state rather than events and have to be polled.

import { useEffect, useRef, useState } from "react";
import {
  actionForButton,
  pressedSince,
  type RemoteAction,
  type RemoteMapping,
} from "./remote";

/**
 * Calls `onAction` once per button press on any connected gamepad.
 *
 * Polling runs on animation frames, which the browser already pauses when
 * the tab is hidden, and stops entirely when nothing is connected — so an
 * ordinary laptop session costs nothing.
 */
export function useGamepadRemote(
  mapping: RemoteMapping,
  enabled: boolean,
  onAction: (action: RemoteAction) => void
) {
  const [connected, setConnected] = useState<string | null>(null);
  // Kept in refs so a re-render mid-session can't restart the loop and lose
  // the previous button state, which would replay a held button as a press.
  const actionRef = useRef(onAction);
  const mappingRef = useRef(mapping);
  useEffect(() => {
    actionRef.current = onAction;
    mappingRef.current = mapping;
  }, [onAction, mapping]);

  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.getGamepads) {
      setConnected(null);
      return;
    }
    let frame = 0;
    const previous = new Map<number, boolean[]>();
    let stopped = false;

    const poll = () => {
      if (stopped) return;
      const pads = navigator.getGamepads?.() ?? [];
      let anyConnected: string | null = null;
      for (const pad of pads) {
        if (!pad) continue;
        anyConnected = pad.id;
        const pressed = pad.buttons.map((b) => b.pressed);
        const before = previous.get(pad.index) ?? [];
        for (const index of pressedSince(before, pressed)) {
          const action = actionForButton(mappingRef.current, index);
          if (action) actionRef.current(action);
        }
        previous.set(pad.index, pressed);
      }
      setConnected((prev) => (prev === anyConnected ? prev : anyConnected));
      frame = requestAnimationFrame(poll);
    };

    // A gamepad stays invisible to the page until it sends something, so
    // this listener is what makes "press a button to wake it up" work.
    const onConnect = () => {
      if (!frame) frame = requestAnimationFrame(poll);
    };
    window.addEventListener("gamepadconnected", onConnect);
    frame = requestAnimationFrame(poll);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("gamepadconnected", onConnect);
    };
  }, [enabled]);

  return connected;
}

/**
 * The same polling, but reporting raw button indices — used by the setup
 * screen so you can press a button and see it bound.
 */
export function useGamepadCapture(
  active: boolean,
  onButton: (index: number, padId: string) => void
) {
  const cb = useRef(onButton);
  useEffect(() => {
    cb.current = onButton;
  }, [onButton]);

  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.getGamepads) return;
    let frame = 0;
    let stopped = false;
    const previous = new Map<number, boolean[]>();
    const poll = () => {
      if (stopped) return;
      for (const pad of navigator.getGamepads?.() ?? []) {
        if (!pad) continue;
        const pressed = pad.buttons.map((b) => b.pressed);
        for (const index of pressedSince(previous.get(pad.index) ?? [], pressed)) {
          cb.current(index, pad.id);
        }
        previous.set(pad.index, pressed);
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [active]);
}
