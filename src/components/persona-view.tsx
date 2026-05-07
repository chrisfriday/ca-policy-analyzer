"use client";

import { useState } from "react";
import {
  PersonaCoverageResult,
  PersonaCoverageRow,
  ControlCoverage,
  ControlStatus,
} from "@/lib/persona-coverage";
import { PERSONA_META } from "@/lib/personas";
import { ScoreRing, Card } from "./ui-primitives";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  MinusCircle,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PersonaViewProps {
  result: PersonaCoverageResult;
}

const STATUS_META: Record<
  ControlStatus,
  { label: string; cls: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  present: {
    label: "Present",
    cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    Icon: CheckCircle2,
  },
  partial: {
    label: "Report-only",
    cls: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    Icon: AlertTriangle,
  },
  missing: {
    label: "Missing",
    cls: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    Icon: XCircle,
  },
  "n/a": {
    label: "N/A",
    cls: "bg-gray-700/40 text-gray-400 border-gray-600/40",
    Icon: MinusCircle,
  },
};

function StatusBadge({ status }: { status: ControlStatus }) {
  const m = STATUS_META[status];
  const Icon = m.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        m.cls
      )}
    >
      <Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}

function ControlRow({ ctrl }: { ctrl: ControlCoverage }) {
  const [open, setOpen] = useState(false);
  const hasPolicies =
    ctrl.satisfyingPolicies.length > 0 || ctrl.reportOnlyPolicies.length > 0;
  return (
    <div className="rounded-md border border-gray-800 bg-gray-950/40">
      <button
        onClick={() => hasPolicies && setOpen((o) => !o)}
        disabled={!hasPolicies}
        className={cn(
          "flex w-full items-start justify-between gap-3 px-3 py-2 text-left",
          hasPolicies && "hover:bg-gray-900/60"
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {hasPolicies ? (
              open ? (
                <ChevronDown className="h-3.5 w-3.5 text-gray-500" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
              )
            ) : (
              <span className="inline-block w-3.5" />
            )}
            <span className="text-sm font-medium text-gray-200">
              {ctrl.label}
            </span>
          </div>
          <p className="mt-0.5 pl-5 text-xs text-gray-500">{ctrl.description}</p>
        </div>
        <StatusBadge status={ctrl.status} />
      </button>
      {open && hasPolicies && (
        <div className="border-t border-gray-800 px-3 py-2 pl-8 text-xs">
          {ctrl.satisfyingPolicies.length > 0 && (
            <div className="mb-1.5">
              <p className="mb-1 text-gray-400">Enforced by:</p>
              <ul className="space-y-0.5">
                {ctrl.satisfyingPolicies.map((p) => (
                  <li key={p.id} className="text-emerald-300">
                    • {p.displayName}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ctrl.reportOnlyPolicies.length > 0 && (
            <div>
              <p className="mb-1 text-gray-400">Report-only:</p>
              <ul className="space-y-0.5">
                {ctrl.reportOnlyPolicies.map((p) => (
                  <li key={p.id} className="text-amber-300">
                    • {p.displayName}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PersonaCard({ row }: { row: PersonaCoverageRow }) {
  const [open, setOpen] = useState(row.status !== "present");
  const meta = PERSONA_META[row.persona];

  const scoreColor =
    row.score >= 90
      ? "text-emerald-400"
      : row.score >= 60
        ? "text-amber-400"
        : "text-rose-400";

  return (
    <Card>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 items-center gap-3">
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" />
          )}
          <span className="text-2xl">{meta.emoji}</span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-white">
              {meta.label}
            </h3>
            <p className="truncate text-xs text-gray-400">{meta.description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <div className={cn("text-lg font-bold tabular-nums", scoreColor)}>
              {row.score}%
            </div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500">
              {row.controls.filter((c) => c.status === "present").length}/
              {row.controls.length} controls
            </div>
          </div>
          <StatusBadge status={row.status} />
        </div>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-gray-800 pt-3">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Users className="h-3.5 w-3.5" />
            <span>
              {row.enabledCount} enabled / {row.assignedPolicies.length} total policy
              {row.assignedPolicies.length === 1 ? "" : "ies"} matched to this persona
            </span>
          </div>

          {row.controls.length === 0 ? (
            <p className="text-xs text-gray-500">
              No required controls defined for this persona.
            </p>
          ) : (
            <div className="space-y-1.5">
              {row.controls.map((c) => (
                <ControlRow key={c.control} ctrl={c} />
              ))}
            </div>
          )}

          {row.assignedPolicies.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-200">
                Show {row.assignedPolicies.length} matched polic
                {row.assignedPolicies.length === 1 ? "y" : "ies"}
              </summary>
              <ul className="mt-2 space-y-0.5 pl-3 text-xs">
                {row.assignedPolicies.map((p) => (
                  <li
                    key={p.id}
                    className={cn(
                      p.state === "enabled"
                        ? "text-emerald-300"
                        : p.state === "enabledForReportingButNotEnforced"
                          ? "text-amber-300"
                          : "text-gray-500"
                    )}
                  >
                    • {p.displayName}{" "}
                    <span className="text-gray-500">({p.state})</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

export function PersonaView({ result }: PersonaViewProps) {
  const presentCount = result.rows.reduce(
    (n, r) => n + r.controls.filter((c) => c.status === "present").length,
    0
  );
  const partialCount = result.rows.reduce(
    (n, r) => n + r.controls.filter((c) => c.status === "partial").length,
    0
  );
  const missingCount = result.rows.reduce(
    (n, r) => n + r.controls.filter((c) => c.status === "missing").length,
    0
  );

  return (
    <div className="space-y-6">
      {/* Summary card */}
      <Card>
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <ScoreRing score={result.overallScore} />
            <div>
              <h2 className="text-lg font-semibold text-white">
                Persona × Control Coverage
              </h2>
              <p className="mt-1 max-w-xl text-sm text-gray-400">
                Required controls per Zero Trust persona, scored against the
                tenant&apos;s enabled CA policies. Aligned with{" "}
                <a
                  href="https://github.com/microsoft/ConditionalAccessforZeroTrustResources"
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  Claus Jespersen&apos;s persona framework
                </a>
                .
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-emerald-400">
                {presentCount}
              </div>
              <div className="text-xs uppercase tracking-wider text-gray-500">
                Present
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-amber-400">
                {partialCount}
              </div>
              <div className="text-xs uppercase tracking-wider text-gray-500">
                Report-only
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-rose-400">
                {missingCount}
              </div>
              <div className="text-xs uppercase tracking-wider text-gray-500">
                Missing
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Per-persona cards */}
      <div className="space-y-3">
        {result.rows.map((row) => (
          <PersonaCard key={row.persona} row={row} />
        ))}
      </div>
    </div>
  );
}
