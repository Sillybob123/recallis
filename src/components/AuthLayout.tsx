import type { ReactNode } from "react";
import {
  CalendarCheck,
  Layers,
  NotebookPen,
  Repeat,
  ScanEye,
  Sparkles,
} from "lucide-react";

const BRAND_NAVY = "#002871";

/**
 * What the app actually does, in the order someone new would meet it: make
 * cards, mask a slide, let the schedule decide, drill freely, write the
 * lecture up, plan the term. Six is the most a panel can say before it
 * stops being read.
 */
const HIGHLIGHTS = [
  {
    icon: Layers,
    title: "Flashcards and cloze",
    body: "Plain cards and {{c1::deletions}} in the same deck. Import an .apkg and your Anki schedule comes with it.",
  },
  {
    icon: ScanEye,
    title: "Image occlusion",
    body: "Mask any slide — rectangles, ellipses, polygons. Group masks, black out a spoiler, and add an explanation that appears with the answer.",
  },
  {
    icon: Repeat,
    title: "Spaced repetition",
    body: "FSRS scheduling, the same one modern Anki uses, so a card comes back the day before you'd forget it.",
  },
  {
    icon: Sparkles,
    title: "Repeat mode",
    body: "Drill a deck as hard as you like the night before an exam. Your schedule doesn't move.",
  },
  {
    icon: NotebookPen,
    title: "Lecture notes",
    body: "Write beside the slide, turn any line into a card, and keep the whole lecture as one running record.",
  },
  {
    icon: CalendarCheck,
    title: "Academic planner",
    body: "Import your timetable and tick off your routine per session. It knows when your exams are and emails you before them.",
  },
];

/** Split-screen shell shared by the login and signup pages. */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Brand panel */}
      <div
        className="relative flex flex-col justify-between overflow-hidden px-7 py-9 text-white lg:w-[47%] lg:px-14 lg:py-14"
        style={{
          background: `linear-gradient(150deg, ${BRAND_NAVY} 0%, #0b3f9e 55%, #1256c9 100%)`,
        }}
      >
        {/* soft light blooms */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, #7cc6ff 0%, transparent 70%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: "radial-gradient(circle, #4f9bff 0%, transparent 70%)" }}
        />

        <div className="relative flex items-center" style={{ gap: "11px" }}>
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/95 shadow-sm">
            <img src="/logo.png" alt="" className="h-8 w-8 object-contain" />
          </span>
          <span
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 600,
              fontSize: "26px",
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            Recallis
          </span>
        </div>

        <div className="relative my-8 max-w-lg lg:my-0">
          <h2
            className="mb-3 text-[30px] leading-[1.15] lg:text-[40px]"
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "-0.025em",
            }}
          >
            Everything you study,
            <br />
            in one place.
          </h2>
          <p className="text-[15px] leading-relaxed text-blue-100/85">
            Built for medical school. Your notes, your cards and your timetable
            in one app, so the lecture you sat through this morning becomes the
            cards you review tonight — without retyping any of it.
          </p>

          {/* On a phone this list sits under the form instead, so the thing
              you came to do isn't below a page of features. */}
          <ul className="mt-9 hidden space-y-4 lg:block">
            {HIGHLIGHTS.map(({ icon: Icon, title: t, body }) => (
              <li key={t} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/12 ring-1 ring-white/15">
                  <Icon size={15} />
                </span>
                <div>
                  <p className="text-sm font-semibold">{t}</p>
                  <p className="text-[13px] leading-snug text-blue-100/75">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative space-y-1.5">
          <p className="text-[13px] text-blue-100/75">
            Also: exports back to Anki, works with a Bluetooth study remote,
            and explains the Latin and Greek behind anatomy terms as you read
            them.
          </p>
          <p className="text-xs text-blue-100/55">
            Your decks, notes and images are private to your account.
          </p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col items-center bg-slate-50 px-6 py-10 lg:justify-center lg:py-12">
        <div className="w-full max-w-sm">
          <div className="mb-7 flex items-center gap-2.5 lg:hidden">
            <img src="/logo.png" alt="" className="h-9 w-9 object-contain" />
            <span
              style={{
                fontFamily: "'Inter', system-ui, sans-serif",
                fontWeight: 600,
                fontSize: "24px",
                letterSpacing: "-0.02em",
                color: BRAND_NAVY,
                lineHeight: 1,
              }}
            >
              Recallis
            </span>
          </div>

          <h1
            className="mb-1.5 text-[27px] text-slate-900"
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </h1>
          <p className="mb-7 text-sm leading-relaxed text-slate-500">{subtitle}</p>

          {children}

          <div className="mt-7 text-center text-sm text-slate-500">{footer}</div>
        </div>

        {/* The same six, for the screen where the panel above is a header
            rather than a column. */}
        <div className="mt-12 w-full max-w-sm lg:hidden">
          <p className="mb-4 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            What you get
          </p>
          <ul className="space-y-3.5">
            {HIGHLIGHTS.map(({ icon: Icon, title: t, body }) => (
              <li key={t} className="flex gap-3">
                <span
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
                  style={{ backgroundColor: BRAND_NAVY }}
                >
                  <Icon size={14} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{t}</p>
                  <p className="text-[13px] leading-snug text-slate-500">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Labeled input styled for the auth forms. */
export function AuthField({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-slate-700">
        {label}
        {hint && <span className="text-xs font-normal text-slate-400">{hint}</span>}
      </span>
      <input
        {...props}
        className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#0b3f9e] focus:ring-4 focus:ring-[#0b3f9e]/10"
      />
    </label>
  );
}

export const AUTH_BUTTON_CLASS =
  "w-full rounded-lg py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 disabled:opacity-60";
export const AUTH_BUTTON_STYLE = { backgroundColor: BRAND_NAVY };
