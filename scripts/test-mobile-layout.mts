// Mobile layout hazards, checked against the source.
//
// Not a substitute for looking at a phone, but these three patterns are the
// ones that put a page off the side of a screen, and each is precise enough
// to check mechanically. They're worth a test because they are added by
// accident — nobody writes a fixed viewport height meaning "and squash the
// stacked version too".
import { readdirSync, readFileSync } from "node:fs";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const files = [
  ...readdirSync("src/pages").map((f) => `src/pages/${f}`),
  ...readdirSync("src/components").map((f) => `src/components/${f}`),
].filter((f) => f.endsWith(".tsx"));

const sources = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const name = (f: string) => f.split("/").pop();

// ---------- 1. a dialog has to fit a short screen ----------
// A modal taller than the viewport with no way to scroll puts its buttons
// somewhere you cannot reach, which on a phone means the thing cannot be
// dismissed.
console.log("dialogs fit on a short screen:");
for (const [file, src] of sources) {
  if (!/fixed inset-0 z-\d/.test(src)) continue;
  // Confetti is an overlay, not a dialog.
  if (name(file) === "Confetti.tsx") continue;
  const guarded = /max-h-\[|max-h-full|overflow-y-auto/.test(src);
  check(`${name(file)} caps its height or scrolls`, guarded);
}

// ---------- 2. viewport-height layouts must not apply when stacked ----------
// Three columns sharing one screen's height is right. The same height with
// the columns stacked gives each a third of a screen.
console.log("\nviewport-height layouts are desktop-only:");
for (const [file, src] of sources) {
  const matches = src.match(/(?:^|\s|")((?:\w+:)?h-\[calc\(100vh[^\]]*\])/g) ?? [];
  for (const raw of matches) {
    const cls = raw.trim().replace(/^"/, "");
    check(
      `${name(file)}: ${cls} is behind a breakpoint`,
      /^(sm|md|lg|xl):/.test(cls),
      "a fixed screen height applied to a stacked column squashes it"
    );
  }
}
if (![...sources.values()].some((s) => /h-\[calc\(100vh/.test(s))) {
  check("nothing pins a full viewport height", true);
}

// ---------- 3. anything wider than a phone has to scroll ----------
// A table wider than the screen is fine, as long as it is the table that
// scrolls and not the page.
console.log("\nwide content scrolls rather than stretching the page:");
for (const [file, src] of sources) {
  const wide = src.match(/min-w-\[(\d+)(px|rem)\]/g) ?? [];
  const tooWide = wide.filter((m) => {
    const [, n, unit] = /min-w-\[(\d+)(px|rem)\]/.exec(m)!;
    const px = unit === "rem" ? Number(n) * 16 : Number(n);
    return px > 380; // narrower than the narrowest phone in common use
  });
  if (tooWide.length === 0) continue;
  check(
    `${name(file)} puts its wide content in a scroller`,
    src.includes("overflow-x-auto"),
    tooWide.join(", ")
  );
}

// ---------- 4. long unbroken words can't stretch the page ----------
console.log("\nuser text can always break:");
{
  const css = readFileSync("src/index.css", "utf8");
  check(
    "the page breaks long words",
    /overflow-wrap:\s*break-word/.test(css),
    "deck paths and pasted URLs have nowhere else to break"
  );
}

// ---------- metadata ----------
// What a crawler and a shared link see. Wrong here is invisible until
// somebody pastes the address into a chat and it looks like nothing.
console.log("\nmetadata:");
{
  const html = readFileSync("index.html", "utf8");
  const robots = readFileSync("public/robots.txt", "utf8");
  const sitemap = readFileSync("public/sitemap.xml", "utf8");

  for (const tag of ["og:title", "og:description", "og:image", "og:url", "twitter:card"]) {
    check(`${tag} is set`, html.includes(tag));
  }
  check("the preview image is an absolute URL", /og:image" content="https:\/\//.test(html));
  check("there is a canonical address", html.includes('rel="canonical"'));
  check("crawlers are told what to do", /name="robots"/.test(html));
  check("the app describes itself in structured data", html.includes('"@type": "WebApplication"'));

  check("robots.txt points at the sitemap", robots.includes("Sitemap: https://recallis.org/sitemap.xml"));
  check(
    "and keeps crawlers out of the signed-in pages",
    ["/deck/", "/notes", "/planner", "/account", "/creator"].every((p) =>
      robots.includes(`Disallow: ${p}`)
    ),
    "there is nothing there without a login anyway"
  );
  check(
    "the sitemap uses the namespace that makes it a sitemap",
    sitemap.includes("http://www.sitemaps.org/schemas/sitemap/0.9"),
    "sitemaps.org, plural — the singular is a different, nonexistent thing"
  );
  check("and lists the public pages", sitemap.includes("https://recallis.org/signup"));
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} failing.`);
process.exit(failures === 0 ? 0 : 1);
