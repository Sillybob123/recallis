/**
 * Random id generator.
 *
 * `crypto.randomUUID` only exists in Safari 15.4+ and needs a secure context,
 * so a browser one version behind would throw on every shape, slide, and
 * upload path. Falls back to getRandomValues, then to Math.random.
 */
export function uid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();

  if (c && typeof c.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    // RFC 4122 version 4 layout
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
