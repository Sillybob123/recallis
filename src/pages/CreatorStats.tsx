import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { Layout } from "../components/Layout";
import { fetchSignups, type SignupRecord } from "../lib/firestore";
import { isAdmin } from "../lib/admin";
import { usePageTitle } from "../lib/pageTitle";

const DAY = 86400000;

function when(at: number): string {
  if (!at) return "—";
  const ago = Date.now() - at;
  if (ago < 60000) return "just now";
  if (ago < 3600000) return `${Math.round(ago / 60000)}m ago`;
  if (ago < DAY) return `${Math.round(ago / 3600000)}h ago`;
  if (ago < 7 * DAY) return `${Math.round(ago / DAY)}d ago`;
  return new Date(at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/**
 * How the site is doing: who has signed up, who is new, and whether anyone
 * is coming back.
 *
 * Visible to one account. The menu entry that leads here is hidden from
 * everyone else, but that is only tidiness — the collection this reads is
 * closed to every other account by rule, so a hidden link is not what keeps
 * it private.
 */
export function CreatorStats() {
  usePageTitle("Creator stats");
  const { user } = useAuth();
  const [rows, setRows] = useState<SignupRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !isAdmin(user.uid)) return;
    fetchSignups()
      .then((list) =>
        setRows([...list].sort((a, b) => b.joinedAt - a.joinedAt))
      )
      .catch(() => setError("Couldn't load that — check your connection."));
  }, [user]);

  const stats = useMemo(() => {
    if (!rows) return null;
    const now = Date.now();
    const since = (days: number) => now - days * DAY;
    return {
      total: rows.length,
      joined7: rows.filter((r) => r.joinedAt >= since(7)).length,
      joined30: rows.filter((r) => r.joinedAt >= since(30)).length,
      active1: rows.filter((r) => r.lastActiveAt >= since(1)).length,
      active7: rows.filter((r) => r.lastActiveAt >= since(7)).length,
      // Someone who signed up, looked once and never came back.
      returning: rows.filter((r) => r.activeDays > 1).length,
      weeks: (() => {
        const out: { label: string; count: number }[] = [];
        for (let w = 7; w >= 0; w--) {
          const from = now - (w + 1) * 7 * DAY;
          const to = now - w * 7 * DAY;
          out.push({
            label: w === 0 ? "This week" : `${w}w ago`,
            count: rows.filter((r) => r.joinedAt >= from && r.joinedAt < to).length,
          });
        }
        return out;
      })(),
    };
  }, [rows]);

  if (user && !isAdmin(user.uid)) return <Navigate to="/" replace />;
  if (!user) return null;

  return (
    <Layout>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Creator stats</h1>
          <p className="text-sm text-slate-500">
            Who has signed up, and whether they're coming back.
          </p>
        </div>
        <span className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-500">
          <ShieldCheck size={13} /> Only you can see this
        </span>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {!rows || !stats ? (
        !error && (
          <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-400">
            <Loader2 size={18} className="mx-auto mb-2 animate-spin" />
            Counting…
          </div>
        )
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Signed up" value={stats.total} note="accounts in total" />
            <Tile
              label="New this week"
              value={stats.joined7}
              note={`${stats.joined30} in the last 30 days`}
              accent
            />
            <Tile
              label="Here today"
              value={stats.active1}
              note={`${stats.active7} in the last week`}
            />
            <Tile
              label="Came back"
              value={stats.returning}
              note={
                stats.total > 0
                  ? `${Math.round((stats.returning / stats.total) * 100)}% opened it on more than one day`
                  : ""
              }
            />
          </div>

          <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-bold text-slate-800">
              Sign-ups by week
            </h2>
            <div className="flex items-end gap-2">
              {stats.weeks.map((w) => {
                const tallest = Math.max(...stats.weeks.map((x) => x.count), 1);
                return (
                  <div key={w.label} className="flex flex-1 flex-col items-center gap-1.5">
                    <span className="text-xs font-semibold tabular-nums text-slate-600">
                      {w.count || ""}
                    </span>
                    <div
                      className="w-full rounded-t bg-indigo-500"
                      style={{
                        height: `${Math.max((w.count / tallest) * 90, w.count ? 6 : 2)}px`,
                        opacity: w.count ? 1 : 0.25,
                      }}
                    />
                    <span className="text-[10px] text-slate-400">{w.label}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[10px] font-semibold uppercase text-slate-400 sm:text-[11px] sm:tracking-wide">
              <span className="flex-1">Who</span>
              <span className="w-20 text-right">Joined</span>
              <span className="w-20 text-right">Last here</span>
              <span className="w-12 text-right">Days</span>
            </div>
            {rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-slate-400">
                Nobody has signed up yet. You'll see them here as they arrive.
              </p>
            ) : (
              <ul>
                {rows.map((r) => (
                  <li
                    key={r.uid}
                    className="flex items-center gap-2 border-b border-slate-50 px-4 py-2.5 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800">
                        {r.name || "(no name given)"}
                      </span>
                      <span className="block truncate text-xs text-slate-400">
                        {r.email}
                      </span>
                    </span>
                    <span className="w-20 text-right text-xs text-slate-500">
                      {when(r.joinedAt)}
                    </span>
                    <span
                      className={`w-20 text-right text-xs ${
                        Date.now() - r.lastActiveAt < 2 * DAY
                          ? "font-semibold text-emerald-600"
                          : "text-slate-500"
                      }`}
                    >
                      {when(r.lastActiveAt)}
                    </span>
                    <span className="w-12 text-right text-xs font-semibold tabular-nums text-slate-600">
                      {r.activeDays || 1}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="mt-3 text-xs leading-relaxed text-slate-400">
            "Days" counts the separate days an account has opened Recallis, so
            it separates someone using it from someone who signed up and left.
            Nothing here records what anyone studies — only that they were
            here.
          </p>
        </>
      )}
    </Layout>
  );
}

function Tile({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: number;
  note?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        accent ? "border-indigo-200 bg-indigo-50" : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900">{value}</p>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
    </div>
  );
}
