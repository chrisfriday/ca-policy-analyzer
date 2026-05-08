/**
 * Tenant Snapshot Diff (Phase 7)
 *
 * Persists a lightweight snapshot of every analysis run to localStorage and
 * compares the most recent run against the previous one to surface:
 *
 *   - Policies **added** since last run
 *   - Policies **removed** since last run
 *   - Policies **modified** (state change, controls changed, scope changed)
 *   - Score deltas (overall, CIS, Zero Trust scorecard, baseline coverage)
 *   - Finding count deltas by severity
 *
 * Storage strategy:
 *   - One slot per `tenantId` keyed `ca-snapshot:<tenantId>`
 *   - We keep only the *previous* snapshot — when a new analysis runs we
 *     diff against the stored one, then overwrite it with the new state
 *   - Snapshot is a slim subset of TenantContext + AnalysisResult — no
 *     PII beyond what was already in the policy displayName
 *
 * Nothing here calls Graph. It operates entirely on the in-memory result of
 * the current analysis plus what was previously stored.
 */

import { ConditionalAccessPolicy, TenantContext } from "./graph-client";
import { AnalysisResult, CompositeScoreResult, Severity } from "./analyzer";
import { CISAlignmentResult } from "@/data/cis-benchmarks";
import { ZeroTrustScorecard } from "./zero-trust-scorecard";
import { BaselineGapResult } from "./baseline-gap";

// ─── Snapshot shape ──────────────────────────────────────────────────────────

export interface PolicySnapshot {
  id: string;
  displayName: string;
  state: ConditionalAccessPolicy["state"];
  /** A stable hash of the comparable parts of the policy. */
  shape: string;
  /** Human-readable summary of grants + scope. */
  summary: string;
}

export interface TenantSnapshot {
  schemaVersion: 2;
  tenantId: string;
  tenantDisplayName: string;
  capturedAt: string;
  policies: PolicySnapshot[];
  scores: {
    overall: number;
    cisAlignment: number | null;
    zeroTrust: number | null;
    baselineCoverage: number | null;
  };
  findings: Record<Severity, number>;
}

// ─── Diff shape ──────────────────────────────────────────────────────────────

export type PolicyChangeKind = "added" | "removed" | "modified";

export interface PolicyChange {
  kind: PolicyChangeKind;
  id: string;
  displayName: string;
  /** Reason a "modified" change was detected; empty for added/removed. */
  changes: string[];
  /** Snapshot rows for context. */
  before?: PolicySnapshot;
  after?: PolicySnapshot;
}

export interface ScoreDelta {
  label: string;
  before: number | null;
  after: number | null;
  delta: number | null;
}

export interface SnapshotDiff {
  hasPrevious: boolean;
  previousCapturedAt: string | null;
  currentCapturedAt: string;
  added: PolicyChange[];
  removed: PolicyChange[];
  modified: PolicyChange[];
  scoreDeltas: ScoreDelta[];
  findingDeltas: Array<{ severity: Severity; before: number; after: number; delta: number }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "ca-snapshot:";

/** Stable string description of a policy's structure for change detection. */
function policyShape(p: ConditionalAccessPolicy): string {
  const c = p.conditions;
  const parts: string[] = [
    `state=${p.state}`,
    `apps:i=${[...c.applications.includeApplications].sort().join(",")}`,
    `apps:e=${[...c.applications.excludeApplications].sort().join(",")}`,
    `users:i=${[...c.users.includeUsers].sort().join(",")}`,
    `users:e=${[...c.users.excludeUsers].sort().join(",")}`,
    `groups:i=${[...c.users.includeGroups].sort().join(",")}`,
    `groups:e=${[...c.users.excludeGroups].sort().join(",")}`,
    `roles:i=${[...c.users.includeRoles].sort().join(",")}`,
    `roles:e=${[...c.users.excludeRoles].sort().join(",")}`,
    `signInRisk=${[...(c.signInRiskLevels ?? [])].sort().join(",")}`,
    `userRisk=${[...(c.userRiskLevels ?? [])].sort().join(",")}`,
    `client=${[...(c.clientAppTypes ?? [])].sort().join(",")}`,
  ];
  if (p.grantControls) {
    parts.push(
      `grant=${p.grantControls.operator}:${[...(p.grantControls.builtInControls ?? [])].sort().join(",")}`
    );
    if (p.grantControls.authenticationStrength?.id) {
      parts.push(`authStrength=${p.grantControls.authenticationStrength.id}`);
    }
  }
  if (p.sessionControls) {
    if (p.sessionControls.signInFrequency?.isEnabled) parts.push("session:sif");
    if (p.sessionControls.persistentBrowser?.isEnabled) parts.push("session:pb");
  }
  return parts.join("|");
}

function policySummary(p: ConditionalAccessPolicy): string {
  const grants = p.grantControls?.builtInControls?.join("+") ?? "—";
  const auth = p.grantControls?.authenticationStrength?.displayName;
  const userScope =
    p.conditions.users.includeUsers.includes("All")
      ? "All users"
      : p.conditions.users.includeRoles.length > 0
        ? `${p.conditions.users.includeRoles.length} role(s)`
        : `${p.conditions.users.includeUsers.length} user(s) / ${p.conditions.users.includeGroups.length} group(s)`;
  return `${userScope} → ${grants}${auth ? ` (${auth})` : ""}`;
}

// ─── Snapshot capture ────────────────────────────────────────────────────────

export function captureSnapshot(args: {
  context: TenantContext;
  analysis: AnalysisResult;
  cis?: CISAlignmentResult | null;
  composite?: CompositeScoreResult | null;
  scorecard?: ZeroTrustScorecard | null;
  baselineGap?: BaselineGapResult | null;
}): TenantSnapshot {
  const { context, analysis, cis, composite, scorecard, baselineGap } = args;
  const findings: Record<Severity, number> = {
    critical: 0, high: 0, medium: 0, low: 0, info: 0,
  };
  for (const f of analysis.findings) {
    findings[f.severity] = (findings[f.severity] ?? 0) + 1;
  }

  return {
    schemaVersion: 2,
    tenantId: context.tenantId,
    tenantDisplayName: context.tenantDisplayName,
    capturedAt: new Date().toISOString(),
    policies: context.policies.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      state: p.state,
      shape: policyShape(p),
      summary: policySummary(p),
    })),
    scores: {
      overall: composite?.overall ?? analysis.overallScore,
      cisAlignment: cis?.alignmentScore ?? null,
      zeroTrust: scorecard?.overall ?? null,
      baselineCoverage: baselineGap?.coverageScore ?? null,
    },
    findings,
  };
}

// ─── Storage ─────────────────────────────────────────────────────────────────

export function loadStoredSnapshot(tenantId: string): TenantSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${tenantId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TenantSnapshot;
    if (parsed.schemaVersion !== 2) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSnapshot(snapshot: TenantSnapshot): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      `${STORAGE_PREFIX}${snapshot.tenantId}`,
      JSON.stringify(snapshot)
    );
  } catch {
    // Quota / disabled storage — silently skip. Snapshot is non-critical.
  }
}

export function clearSnapshot(tenantId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${tenantId}`);
  } catch {
    /* ignore */
  }
}

// ─── Diff ────────────────────────────────────────────────────────────────────

function describeShapeChange(before: string, after: string): string[] {
  const beforeMap = new Map<string, string>();
  const afterMap = new Map<string, string>();
  for (const part of before.split("|")) {
    const idx = part.indexOf("=");
    if (idx > 0) beforeMap.set(part.slice(0, idx), part.slice(idx + 1));
  }
  for (const part of after.split("|")) {
    const idx = part.indexOf("=");
    if (idx > 0) afterMap.set(part.slice(0, idx), part.slice(idx + 1));
  }
  const keys = new Set<string>([...beforeMap.keys(), ...afterMap.keys()]);
  const changes: string[] = [];
  for (const key of keys) {
    const b = beforeMap.get(key) ?? "(none)";
    const a = afterMap.get(key) ?? "(none)";
    if (b !== a) {
      changes.push(`${key}: ${b || "∅"} → ${a || "∅"}`);
    }
  }
  return changes.slice(0, 6);
}

export function diffSnapshots(
  previous: TenantSnapshot | null,
  current: TenantSnapshot
): SnapshotDiff {
  if (!previous) {
    return {
      hasPrevious: false,
      previousCapturedAt: null,
      currentCapturedAt: current.capturedAt,
      added: [],
      removed: [],
      modified: [],
      scoreDeltas: [],
      findingDeltas: [],
    };
  }

  const prev = new Map(previous.policies.map((p) => [p.id, p]));
  const curr = new Map(current.policies.map((p) => [p.id, p]));

  const added: PolicyChange[] = [];
  const removed: PolicyChange[] = [];
  const modified: PolicyChange[] = [];

  for (const [id, c] of curr) {
    const p = prev.get(id);
    if (!p) {
      added.push({ kind: "added", id, displayName: c.displayName, changes: [c.summary], after: c });
      continue;
    }
    if (p.shape !== c.shape || p.displayName !== c.displayName) {
      const changes = describeShapeChange(p.shape, c.shape);
      if (p.displayName !== c.displayName) {
        changes.unshift(`name: "${p.displayName}" → "${c.displayName}"`);
      }
      modified.push({ kind: "modified", id, displayName: c.displayName, changes, before: p, after: c });
    }
  }
  for (const [id, p] of prev) {
    if (!curr.has(id)) {
      removed.push({ kind: "removed", id, displayName: p.displayName, changes: [p.summary], before: p });
    }
  }

  // Sort: added/removed by name, modified by name
  added.sort((a, b) => a.displayName.localeCompare(b.displayName));
  removed.sort((a, b) => a.displayName.localeCompare(b.displayName));
  modified.sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Score deltas
  const scoreDeltas: ScoreDelta[] = [
    { label: "Overall", before: previous.scores.overall, after: current.scores.overall, delta: current.scores.overall - previous.scores.overall },
    {
      label: "CIS alignment",
      before: previous.scores.cisAlignment,
      after: current.scores.cisAlignment,
      delta:
        previous.scores.cisAlignment != null && current.scores.cisAlignment != null
          ? current.scores.cisAlignment - previous.scores.cisAlignment
          : null,
    },
    {
      label: "Zero Trust",
      before: previous.scores.zeroTrust,
      after: current.scores.zeroTrust,
      delta:
        previous.scores.zeroTrust != null && current.scores.zeroTrust != null
          ? current.scores.zeroTrust - previous.scores.zeroTrust
          : null,
    },
    {
      label: "Baseline coverage",
      before: previous.scores.baselineCoverage,
      after: current.scores.baselineCoverage,
      delta:
        previous.scores.baselineCoverage != null && current.scores.baselineCoverage != null
          ? current.scores.baselineCoverage - previous.scores.baselineCoverage
          : null,
    },
  ];

  // Finding deltas
  const severities: Severity[] = ["critical", "high", "medium", "low", "info"];
  const findingDeltas = severities.map((sev) => {
    const before = previous.findings[sev] ?? 0;
    const after = current.findings[sev] ?? 0;
    return { severity: sev, before, after, delta: after - before };
  });

  return {
    hasPrevious: true,
    previousCapturedAt: previous.capturedAt,
    currentCapturedAt: current.capturedAt,
    added,
    removed,
    modified,
    scoreDeltas,
    findingDeltas,
  };
}
