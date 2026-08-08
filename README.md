# Recallis

A private, Firebase-backed flashcard app built for medical school studying. It combines:

- **Quizlet-style flashcards** — front/back cards you flip and type-test, organized into decks per class.
- **Cloze deletion cards** — Anki-style `{{c1::hidden text}}` fill-in-the-blank cards, since a lot of real medical study material (like your `AnatomyExample.txt` export) is written this way.
- **Anki-style Image Occlusion** — upload a lecture slide or diagram, draw boxes over the parts you want to hide, and study in "hide one, guess one" or "hide all, guess one" mode.
- **Firebase** for storage — every deck, card, and image is saved to your own private Firestore + Storage account, locked to your account only.
- **Export to Anki** — turns any deck (including baked image-occlusion PNGs) into a zip with a `.txt` in Anki's own header-directive format (`#separator:tab`, `#notetype column`, `#deck column` — same as Text2Anki), so Anki auto-maps note types and decks on import.
- **Import from Anki, with media** — feed it a real Anki **`.apkg` deck package** (File → Export → Anki Deck Package, "Include media" checked) and it recreates everything client-side: cloze/basic cards with their images uploaded to your Firebase Storage and displayed in-app, **and Image Occlusion Enhanced notes converted into native, editable occlusion sheets** — masks, groupings and all. Handles the modern zstd-compressed Anki format and the legacy one, plus `.colpkg` collection exports and plain `.txt` exports (text-only). Optionally splits into one deck per Anki deck name.
- **Data safety** — offline-first Firestore cache (writes are journaled locally and synced, so a dropped connection never loses a card), one-click full backup to a zip (all decks + cards + images), restore-from-backup that only ever *creates* decks (never overwrites), and an automatic safety snapshot downloaded before any deck deletion.

## Anki mode vs Quizlet mode

The toggle in the header switches the whole app between two study engines:

- **Anki mode** (indigo) — real spaced repetition. Each card/mask has its own SM-2 schedule: new cards go through learning steps (1m → 10m), graduate to 1 day, and grow by an ease factor from there. You grade with the four Anki buttons — **Again / Hard / Good / Easy** — each showing exactly when the card will return (`<10m`, `17d`, `1.1mo`, …). Only cards that are *due* appear (plus up to 20 new cards per session). Lapsed cards drop to a 10-minute relearn step and resume at half their interval.
- **Quizlet mode** (green) — cram freely **without touching the Anki schedule**. Everything is in the session, and a smart in-session scheduler paces repeats: miss a card and it comes back within ~3 cards (and keeps coming back until you get it); answer correctly but slowly and it returns once more near the end of the deck; answer fast and it leaves the session. Perfect for the night before an exam — your spaced-repetition due dates are completely unaffected.

---

## 1. Create your Firebase project

This app needs a Firebase project of your own — I can't create one on your behalf since that requires signing into your Google account.

1. Go to <https://console.firebase.google.com> and click **Add project**. Name it anything (e.g. "med-quizlet").
2. Once created, click the **Web** icon (`</>`) to register a web app. Give it a nickname, skip Firebase Hosting setup for now.
3. Firebase will show you a config object like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "med-quizlet.firebaseapp.com",
     projectId: "med-quizlet",
     storageBucket: "med-quizlet.firebasestorage.app",
     messagingSenderId: "...",
     appId: "1:...:web:...",
   };
   ```
   Keep this tab open — you'll copy these values in step 2.

4. In the left sidebar, go to **Build → Authentication → Get started**, and enable the **Email/Password** sign-in provider.
5. Go to **Build → Firestore Database → Create database**. Choose **production mode** and any region close to you.
6. Go to **Build → Storage → Get started**. Choose production mode, same region.

## 2. Configure this app

```bash
cp .env.example .env
```

Open `.env` and paste in the values from the Firebase config object in step 1.3:

```
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=med-quizlet.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=med-quizlet
VITE_FIREBASE_STORAGE_BUCKET=med-quizlet.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=1:...:web:...
```

These values aren't secret by themselves (they're visible in any Firebase web app's bundled JS) — what actually keeps your data private is the security rules in `firestore.rules` and `storage.rules`, deployed in step 4 below. Locally, `.env` is still git-ignored as good practice.

Install dependencies (already done if you're reading this right after the build) and start the dev server:

```bash
npm install
npm run dev
```

Open the printed `localhost` URL, click **Create an account**, and you're in.

## 3. Deploy the security rules (required)

Without this step, Firestore/Storage will reject all reads and writes by default (safe, but useless). This repo already includes `firestore.rules` and `storage.rules` that lock every document and file to `users/{your-uid}/...` — nobody else can read or write your data, not even other signed-in users of the app.

```bash
firebase login
firebase use --add        # pick the project you created, set it as "default"
firebase deploy --only firestore:rules,storage:rules
```

(`firebase --version` shows `15.15.0` is already installed on this machine, so you just need to log in.)

## 4. (Optional but recommended) Enable CORS for image export

The in-app study mode and editor work fine without this. It's only needed for the **Export to Anki** button to "bake" masked PNG files for image-occlusion cards — that requires reading raw image bytes back out of Firebase Storage from the browser, which Google Cloud Storage blocks by default until you explicitly allow it.

```bash
# Requires the gcloud CLI (https://cloud.google.com/sdk/docs/install)
gcloud auth login
gsutil cors set cors.json gs://YOUR_STORAGE_BUCKET_NAME
```

`YOUR_STORAGE_BUCKET_NAME` is the `storageBucket` value from your `.env`. If you skip this, everything in the app still works — the Anki export will just show a warning and skip baking images for decks that have image occlusion sheets, exporting your basic/cloze cards only.

## 5. Deploy it live

### Option A — Cloudflare Pages (recommended for recallis.org)

1. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, pick the `recallis` GitHub repo.
2. Build settings: framework preset **Vite** (or set Build command `npm run build`, output directory `dist`).
3. Add the six `VITE_FIREBASE_*` environment variables from your `.env` under **Settings → Environment variables** (they're baked into the bundle at build time — without them the deployed site shows the "Firebase isn't configured" screen).
4. **Custom domains → add `recallis.org`** (and `www.recallis.org`). Since your DNS is on Cloudflare, it wires up automatically with SSL.
5. **Important:** in the [Firebase console → Authentication → Settings → Authorized domains](https://console.firebase.google.com/project/med-quizlet/authentication/settings), add `recallis.org`, `www.recallis.org`, and your `*.pages.dev` preview domain — login is refused from unlisted domains.

The repo already contains `public/_redirects` so client-side routes (e.g. `/deck/...`) resolve correctly on Pages.

### Option B — Firebase Hosting

```bash
npm run build
firebase deploy --only hosting
```

---

## How to use it

- **Dashboard** — Anki-style hierarchies render as a tree: each class ("Anatomy") is a collapsible section, with subdecks ("Lab00", "Breast and Thorax") as sub-headers and topic decks as cards beneath. Sections remember whether you left them open. Standalone decks sit above the tree.
- **Study buttons** — **Study all** mixes flashcards, cloze, and image occlusion in one queue; **Cards only** and **Occlusion only** narrow it down.
- **Add card** — Basic (front/back) or Cloze. For cloze, wrap the hidden part in `{{c1::answer}}`, e.g. `The heart has {{c1::four}} chambers.` Use `{{c2::...}}`, `{{c3::...}}` etc. for multiple blanks in one card — each becomes its own study rep, exactly like Anki.
- **Bulk import** — paste a whole list at once. "Term / Definition" mode works like Quizlet's paste import (tab, comma, or dash separated, one card per line or per blank-line block). "Cloze blocks" mode takes multiple `{{c1::...}}` blocks separated by blank lines.
- **New image occlusion** — upload an image (or just paste a screenshot with ⌘V), then draw masks with the **rectangle, ellipse, or polygon** tool (polygon: click points, close by clicking the first point or pressing Enter). Select masks (shift-click for several) to **move, resize, recolor, change opacity, duplicate (⌘D), or delete (⌫)** them. **Group** selected masks so they hide and reveal together as one card — exactly like Anki's grouped occlusions — and give any mask a text label shown as the answer.
- **Study cards** — flips through your basic + cloze cards. Toggle between click-to-flip flashcards and type-the-answer mode. Cards you mark "still learning" come back later in the same session; the session ends once you've gotten every card right once.
- **Study occlusion** — same repeat-until-mastered loop, but for your image occlusion masks. Toggle "hide one, guess one" (only the tested region is covered) vs "hide all, guess one" (everything's covered, you're being asked about one specific highlighted region — the harder mode, good for testing whole-image recall).
- **Export to Anki** — downloads a `.zip` with a single Anki-native `.txt` (header directives + notetype/deck columns, so one import maps everything automatically) plus a `media/` folder of baked images and a step-by-step guide inside the zip. Cloze cards export with the same `{{c1::}}` syntax Anki's native Cloze note type uses.
- **Import from Anki** (Dashboard) — best input is a **`.apkg`** (File → Export → Anki Deck Package, "Include media" checked): cards, images, and image-occlusion sheets all come across, with occlusion masks converted to fully editable native sheets and mask groups preserved. `.colpkg` whole-collection exports work too but can be huge — a per-deck `.apkg` is faster and lighter. Plain `.txt` exports still import cards, but a `.txt` physically contains no image files, so image-based notes need the `.apkg` route.
- **Study occlusion answer view** — after revealing, the tested region shows a dashed amber outline so you can see exactly what was covered (like Anki's answer mask).
- **Back up / Restore** (Dashboard) — "Back up" downloads a zip of every deck, card, mask layout, and (when Storage CORS is configured) every image. "Restore" reads that zip back and creates fresh `(restored)` decks without touching anything existing. Deleting a deck also auto-downloads a snapshot of just that deck first, so even a mistaken delete is recoverable.

## Data model

```
users/{uid}/decks/{deckId}                          — name, subject, color
users/{uid}/decks/{deckId}/cards/{cardId}            — { type: basic | cloze, ...fields, stats }
users/{uid}/decks/{deckId}/occlusions/{sheetId}       — image ref + shapes[] (normalized 0–1 coordinates)
```

Images live in Storage at `users/{uid}/decks/{deckId}/occlusions/{uuid}.{ext}`.

## Known limitations

- Rich text in card fields (bold/italic/lists/images) is supported via a small sanitized-HTML allowlist, matching what your Anki export already uses — but there's no WYSIWYG editor yet, you type the HTML tags directly (`<b>...</b>`, `<i>...</i>`, `<img src="...">` for hosted image URLs).
- The Anki export doesn't parse your existing Anki `.txt`/`.apkg` exports back in — it's export-only, one direction (this app → Anki), since re-importing an Anki Image Occlusion Enhanced export would need its original media files.
- The first production build bundles Firebase + the app into a single ~1MB JS file; fine for personal use, but if you deploy it for others later, code-splitting would help load time.
