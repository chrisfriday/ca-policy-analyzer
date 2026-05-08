"use client";

import { useState } from "react";
import {
  SnapshotDiff,
  PolicyChange,
  PolicyChangeKind,
} from "@/lib/snapshot-diff";
import {
  History,
  Plus,
  Minus,
  Pencil,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus as Equal,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  diff: SnapshotDiff;
}

const KIND_META: Record<
  PolicyChangeKind,
  { label: string; icon: typeof Plus; tone: string; bg: string; border: string }
> = {
  added: { label: "Added", icon: Plus, tone: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  removed: { label: "Removed", icon: Minus, tone: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/30" },
  modified: { label: "Modified", icon: Pencil, tone: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function DeltaPill({ delta }: { delta: number | null }) {
  if (delta == null) {
    return <span className="text-xs text-gray-500">no prior</span>;
  }
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-gray-400">
        <Equal className="h-3 w-3" />0
      </span>
    );
  }
  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-emerald-400">
        <TrendingUp className="h-3 w-3" />+{delta}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-rose-400">
      <TrendingDown className="h-3 w-3" />
      {delta}
    </span>
  );
}

function FindingDeltaPill({ delta, severity }: { delta: number; severity: string }) {
  // For findings, *fewer* is better — invert color logic
  if (delta === 0) {
    return <span className="text-xs text-gray-400">no change</span>;
  }
  if (delta < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-emerald-400">
        <TrendingDown className="h-3 w-3" />
        {delta} {severity}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-rose-400">
      <TrendingUp className="h-3 w-3" />+{delta} {severity}
    </span>
  );
}

function ChangeRow({ change }: { change: PolicyChange }) {
  const [open, setOpen] = useState(false);
  const meta = KIND_META[change.kind];
  const Icon = meta.icon;
  return (
    <div className={cn("rounded-md border p-3", meta.border, meta.bg)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 items-start gap-2">
          {change.changes.length > 0 ? (
            open ? (
              <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
            ) : (
              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", meta.tone)} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-gray-100">
              {change.displayName}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              {meta.label}
              {change.changes.length > 0 ? ` · ${change.changes.length} change${change.changes.length === 1 ? "" : "s"}` : ""}
            </p>
          </div>
        </div>
      </button>
      {open && change.changes.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-gray-800/60 pt-2 pl-7 text-xs text-gray-400">
          {change.changes.map((c, i) => (
            <li key={i} className="list-disc font-mono">
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SnapshotDiffView({ diff }: Props) {
  if (!diff.hasPrevious) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 text-center">
        <History className="mx-auto h-10 w-10 text-gray-600" />
        <h2 className="mt-4 text-base font-semibold text-white">
          No previous snapshot for this tenant
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-400">
          A snapshot of this analysis was just saved. The next time you run an
          analysis on this tenant, this tab will show every policy that was
          added, removed, or modified, plus the score deltas.
        </p>
        <p className="mt-3 text-xs text-gray-500">
          Snapshot captured: {fmtDate(diff.currentCapturedAt)}
        </p>
      </div>
    );
  }

  const totalChanges = diff.added.length + diff.removed.length + diff.modified.length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-blue-400" />
              <h2 className="text-base font-semibold text-white">
                Tenant Snapshot Diff
              </h2>
            </div>
            <p className="mt-1 max-w-2xl text-xs text-gray-400">
              Comparing this run to the previous snapshot saved on{" "}
              <span className="font-medium text-gray-200">
                {fmtDate(diff.previousCapturedAt)}
              </span>
              . Diff is computed entirely client-side from a localStorage
              snapshot — no extra Graph calls.
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold tabular-nums text-white">
              {totalChanges}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500">
              Total changes
            </div>
          </div>
        </div>

        {/* Score deltas */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {diff.scoreDeltas.map((sd) => (
            <div key={sd.label} className="rounded-md border border-gray-800 bg-gray-950 p-3">
              <div className="text-xs uppercase tracking-wider text-gray-500">
                {sd.label}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl font-bold text-white tabular-nums">
                  {sd.after ?? "—"}
                </span>
                <span className="text-xs text-gray-500">
                  was {sd.before ?? "—"}
                </span>
              </div>
              <div className="mt-1">
                <DeltaPill delta={sd.delta} />
              </div>
            </div>
          ))}
        </div>

        {/* Finding deltas */}
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-gray-800 bg-gray-950 p-3">
          <span className="text-xs uppercase tracking-wider text-gray-500">
            Findings:
          </span>
          {diff.findingDeltas.map((fd) => (
            <FindingDeltaPill key={fd.severity} delta={fd.delta} severity={fd.severity} />
          ))}
        </div>
      </div>

      {/* Changes */}
      {totalChanges === 0 ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
          <p className="text-sm text-emerald-300">
            No policy changes since the previous snapshot. The tenant is stable.
          </p>
        </div>
      ) : (
        <>
          {diff.added.length > 0 && (
            <Section title="Added" count={diff.added.length} kind="added">
              {diff.added.map((c) => (
                <ChangeRow key={c.id} change={c} />
              ))}
            </Section>
          )}
          {diff.modified.length > 0 && (
            <Section title="Modified" count={diff.modified.length} kind="modified">
              {diff.modified.map((c) => (
                <ChangeRow key={c.id} change={c} />
              ))}
            </Section>
          )}
          {diff.removed.length > 0 && (
            <Section title="Removed" count={diff.removed.length} kind="removed">
              {diff.removed.map((c) => (
                <ChangeRow key={c.id} change={c} />
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  kind,
  children,
}: {
  title: string;
  count: number;
  kind: PolicyChangeKind;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <div className="flex items-center gap-3">
          {open ? (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-500" />
          )}
          <Icon className={cn("h-4 w-4", meta.tone)} />
          <h3 className="text-sm font-semibold text-white">
            {title} <span className="text-gray-500">({count})</span>
          </h3>
        </div>
      </button>
      {open && <div className="space-y-1.5 border-t border-gray-800 p-3">{children}</div>}
    </div>
  );
}
