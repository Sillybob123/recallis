import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The Content Security Policy, as a meta tag in the built HTML.
 *
 * A response header would be better — a meta tag can't express
 * frame-ancestors, and it only takes effect once the parser reaches it — but
 * the site is served by GitHub Pages, which does not let you set headers. So
 * this is the enforceable half, and firebase.json and public/_headers carry
 * the full set for whichever host is used next.
 *
 * What it is actually for: the app renders HTML that came from somewhere else.
 * Anki decks are imported from files a student downloaded, and RichText puts
 * that markup into the DOM. DOMPurify is the first line and a good one, but a
 * sanitizer is a program with a bug budget, and this is what makes a bypass
 * fail to matter — injected markup has nowhere to send anything and no way to
 * load a script.
 *
 * Each origin below is here because something breaks without it:
 *   script-src   'wasm-unsafe-eval' is sql.js, the SQLite build that reads an
 *                .apkg collection. Note it is not 'unsafe-eval'.
 *   worker-src   blob: is pdf.js, which starts its parser from a blob URL.
 *   style-src    'unsafe-inline' because sanitized deck markup keeps its
 *                style attributes, and Anki decks lean on them heavily.
 *   img-src      blob: and data: for pasted and exported images; googleapis
 *                for Firebase Storage.
 *   connect-src  Firestore, Auth, token refresh and Storage all live under
 *                *.googleapis.com.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-src 'self'",
  "manifest-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.googleapis.com https://*.firebasestorage.app",
  "media-src 'self' data: blob:",
  [
    "connect-src 'self'",
    'https://*.googleapis.com',
    'https://*.firebasestorage.app',
    'https://*.firebaseio.com',
    'wss://*.firebaseio.com',
  ].join(' '),
  'upgrade-insecure-requests',
].join('; ')

/**
 * Injects the policy into the built index.html.
 *
 * Build-only on purpose. In dev, Vite serves an inline module preamble and
 * talks to an HMR websocket, both of which a policy this tight would refuse —
 * so applying it to `vite dev` would only teach you to ignore it.
 */
function csp(): Plugin {
  return {
    name: 'recallis-csp',
    apply: 'build',
    // Ordering is the whole reason this is a string edit rather than Vite's
    // `tags` array. A policy this long is about a kilobyte, and `head-prepend`
    // put it in front of <meta charset>, which pushed the charset declaration
    // past the first 1024 bytes — the window browsers sniff for it. The page
    // is full of em dashes and accented names, so that shows up as mojibake.
    // Charset first, policy immediately after, everything else behind both.
    transformIndexHtml(html) {
      const charset = /<meta\s+charset=["']?[\w-]+["']?\s*\/?>/i
      const match = html.match(charset)
      if (!match) {
        throw new Error(
          'index.html has no <meta charset> to anchor the CSP to. Add one — ' +
            'the policy must not come before it.'
        )
      }
      const meta =
        `\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />` +
        // Not a header, so no substitute for the real ones, but a referrer
        // policy is honoured from a meta tag.
        '\n    <meta name="referrer" content="strict-origin-when-cross-origin" />'
      return html.replace(match[0], `${match[0]}${meta}`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), csp()],
  build: {
    // Pin the output to versions Safari actually ships, rather than trusting
    // whatever the toolchain's default happens to be. Safari 15.4 is the first
    // release with crypto.randomUUID and structuredClone.
    target: ["es2020", "safari15", "chrome90", "firefox90", "edge90"],
  },
})
