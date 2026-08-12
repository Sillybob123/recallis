// Image settings for baking occlusion cards into an Anki package.
//
// Kept apart from ankiExport so the arithmetic can be tested without pulling
// in Firebase, and because the numbers themselves are a decision worth
// finding in one place.

/**
 * Exporting a sheet bakes one image per mask plus one answer image, so a deck
 * of 30 sheets with 161 masks writes 191 images. Written as lossless PNG —
 * which is what it used to do — photographs and slide screenshots inflate
 * enormously, and the result is a package too big to sync to a phone.
 *
 * JPEG is the right fit: the sources are photographs, the masks are flat
 * colour drawn over them, and nothing needs transparency because every pixel
 * is composited onto an opaque canvas first.
 */
export const EXPORT_QUALITY = 0.85;

/** Longest edge kept. Beyond this is detail nobody reads a card at. */
export const MAX_EXPORT_EDGE = 1600;

/**
 * Size to bake at: the image's own, unless it is bigger than anything a card
 * is read at. Most slide screenshots are already under the cap — this is for
 * the phone photo somebody occludes at 4000px.
 *
 * Aspect ratio is preserved because mask geometry is stored as fractions of
 * the image; distorting the canvas would move every mask off its target.
 */
export function exportDimensions(
  width: number,
  height: number
): { width: number; height: number } {
  const w = Math.max(1, Math.round(width) || 1);
  const h = Math.max(1, Math.round(height) || 1);
  const scale = Math.min(1, MAX_EXPORT_EDGE / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}
