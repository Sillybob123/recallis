import { useEffect } from "react";

export const SITE_NAME = "Recallis";
const DEFAULT_TITLE = "Recallis — Flashcards, Cloze & Image Occlusion";

/**
 * Names the browser tab after the page you're on.
 *
 * A single-page app keeps whatever title the HTML shipped with, so every
 * tab, bookmark and history entry reads the same — useless when three of
 * them are open, which during a study session they usually are.
 */
export function usePageTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE_NAME}` : DEFAULT_TITLE;
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);
}
