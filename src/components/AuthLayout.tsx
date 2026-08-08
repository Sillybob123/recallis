import type { ReactNode } from "react";
import { Layers, NotebookPen, ScanEye, Repeat } from "lucide-react";

const BRAND_NAVY = "#002871";

const HIGHLIGHTS = [
  {
    icon: Layers,
    title: "Flashcards & cloze",
    body: "Quizlet-style cards and Anki {{c1::deletions}} in one deck.",
  },
  {
    icon: ScanEye,
    title: "Image occlusion",
    body: "Mask any lecture slide — rectangles, ellipses, polygons, groups.",
  },
  {
    icon: Repeat,
    title: "FSRS spaced repetition",
    body: "Real Anki scheduling, or cram freely without touching it.",
  },
  {
    icon: NotebookPen,
    title: "Lecture notes",
    body: "Take notes on slides and turn any line into a card instantly.",
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
        className="relative flex flex-col justify-between overflow-hidden px-8 py-10 text-white lg:w-[46%] lg:px-14 lg:py-14"
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

        <div className="relative my-10 max-w-md lg:my-0">
          <h2
            className="mb-3 text-3xl leading-tight lg:text-[38px]"
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
          <p className="mb-9 text-[15px] leading-relaxed text-blue-100/85">
            Built for medical school — lecture notes, flashcards, and image
            occlusion that actually talk to each other.
          </p>

          <ul className="space-y-4">
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

        <p className="relative text-xs text-blue-100/60">
          Your decks, notes, and images are private to your account.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center bg-slate-50 px-6 py-12">
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
          <p className="mb-7 text-sm text-slate-500">{subtitle}</p>

          {children}

          <div className="mt-7 text-center text-sm text-slate-500">{footer}</div>
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
