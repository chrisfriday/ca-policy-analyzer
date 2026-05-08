/**
 * Deployment Plan Generator (Phase 5)
 *
 * Turns the gaps surfaced by `analyzeBaselineGaps` into a Graph-ready
 * deployment bundle the operator can import via:
 *
 *   - Microsoft Graph PowerShell SDK (`New-MgIdentityConditionalAccessPolicy`)
 *   - DCToolbox / IntuneCD restore flows
 *   - Plain `Invoke-MgGraphRequest` with a JSON body
 *
 * Every exported policy is forced to **state: "disabled"** so nothing is
 * ever activated by accident — the operator must explicitly flip it to
 * `enabledForReportingButNotEnforced` (report-only) or `enabled` after
 * review.
 *
 * Two formats are produced:
 *
 *   1. **Bundle JSON** — a single `deployment-plan.json` with metadata,
 *      a per-persona summary, and an array of `policies[]` ready for
 *      iteration.
 *   2. **Per-policy JSON files** — one file per missing/drift policy,
 *      named `<persona>-<id>.json`, suitable for git-tracking.
 *
 * The current implementation produces the bundle; the per-policy split
 * is exposed as a helper for future ZIP packaging.
 */

import { BaselineGapResult, BaselineGapEntry } from "./baseline-gap";
import { TemplateAnalysisResult } from "./template-matcher";
import { PolicyTemplate, DeploymentPolicy } from "@/data/policy-templates";
import { Persona, PERSONA_META } from "./personas";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DeploymentPlanPolicy {
  /** Persona this policy targets */
  persona: Persona;
  /** Why this policy is in the plan */
  reason: "missing" | "drift";
  /** Severity inherited from the gap */
  severity: BaselineGapEntry["severity"];
  /** Stable id from the source template */
  templateId: string;
  /** Original template displayName */
  templateDisplayName: string;
  /** One-line summary */
  summary: string;
  /** Why it matters */
  rationale: string;
  /** Action notes — for drift, what differs */
  actionNotes: string[];
  /** The Graph-ready JSON body */
  body: DeploymentPolicy;
}

export interface DeploymentPlanSummary {
  persona: Persona;
  label: string;
  missing: number;
  drift: number;
  total: number;
}

export interface DeploymentPlan {
  /** Schema version (bump when shape changes) */
  schemaVersion: 1;
  /** Tool that generated the plan */
  generator: {
    name: string;
    version: string;
  };
  generatedAt: string;
  /** Metadata about the source baseline */
  baseline: {
    label: string;
    templateCount: number;
    coverageScore: number;
  };
  /** Per-persona summary, ordered like the UI */
  perPersona: DeploymentPlanSummary[];
  /** Top-level counts */
  totals: {
    missing: number;
    drift: number;
    total: number;
  };
  /** All policies the operator needs to deploy, in priority order */
  policies: DeploymentPlanPolicy[];
  /** README-style instructions baked into the plan */
  instructions: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<BaselineGapEntry["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const PLAN_INSTRUCTIONS: string[] = [
  "Review each policy below before applying. Every policy is exported with state=\"disabled\" for safety.",
  "Recommended deploy order: critical -> high -> medium. Within a tier, apply Admins first, then Internals, then Externals.",
  "After import, flip state to \"enabledForReportingButNotEnforced\" (report-only) for at least 7 days before \"enabled\".",
  "PowerShell example: Get-Content deployment-plan.json | ConvertFrom-Json | ForEach-Object { $_.policies | ForEach-Object { New-MgIdentityConditionalAccessPolicy -BodyParameter $_.body } }",
  "DCToolbox: pipe each .body object through Invoke-DCConditionalAccessPolicyDeployment -PolicyJson.",
  "Drift entries (reason=\"drift\") replace existing tenant policies — back them up first via Export-MgIdentityConditionalAccessPolicy or DCToolbox export.",
];

function templateLookup(
  templateResult: TemplateAnalysisResult
): Map<string, PolicyTemplate> {
  const m = new Map<string, PolicyTemplate>();
  for (const match of templateResult.matches) {
    m.set(match.template.id, match.template);
  }
  return m;
}

// ─── Main builder ────────────────────────────────────────────────────────────

export function buildDeploymentPlan(
  gaps: BaselineGapResult,
  templateResult: TemplateAnalysisResult,
  baselineLabel: string,
  generatorVersion: string = "1.14.0"
): DeploymentPlan {
  const templates = templateLookup(templateResult);

  const policies: DeploymentPlanPolicy[] = [];
  for (const entry of gaps.entries) {
    if (entry.kind === "tenant-only") continue; // tenant-only isn't a deploy
    if (!entry.templateId) continue;
    const tpl = templates.get(entry.templateId);
    if (!tpl) continue;

    policies.push({
      persona: entry.persona,
      reason: entry.kind,
      severity: entry.severity,
      templateId: tpl.id,
      templateDisplayName: tpl.displayName,
      summary: tpl.summary,
      rationale: tpl.rationale,
      actionNotes:
        entry.kind === "drift"
          ? entry.details
          : [`Baseline policy "${tpl.displayName}" has no tenant equivalent.`],
      // Force state to disabled regardless of what the template said
      body: { ...tpl.deploymentJson, state: "disabled" },
    });
  }

  // Sort: critical first, then by persona, then by name
  policies.sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    if (a.persona !== b.persona) return a.persona.localeCompare(b.persona);
    return a.templateDisplayName.localeCompare(b.templateDisplayName);
  });

  // Per-persona summary
  const perPersonaMap = new Map<Persona, DeploymentPlanSummary>();
  for (const p of policies) {
    const cur =
      perPersonaMap.get(p.persona) ?? {
        persona: p.persona,
        label: PERSONA_META[p.persona].label,
        missing: 0,
        drift: 0,
        total: 0,
      };
    if (p.reason === "missing") cur.missing += 1;
    if (p.reason === "drift") cur.drift += 1;
    cur.total += 1;
    perPersonaMap.set(p.persona, cur);
  }

  return {
    schemaVersion: 1,
    generator: { name: "ca-policy-analyzer", version: generatorVersion },
    generatedAt: new Date().toISOString(),
    baseline: {
      label: baselineLabel,
      templateCount: gaps.baselineTemplateCount,
      coverageScore: gaps.coverageScore,
    },
    perPersona: Array.from(perPersonaMap.values()),
    totals: {
      missing: policies.filter((p) => p.reason === "missing").length,
      drift: policies.filter((p) => p.reason === "drift").length,
      total: policies.length,
    },
    policies,
    instructions: PLAN_INSTRUCTIONS,
  };
}

// ─── Helpers for the view layer ──────────────────────────────────────────────

/** Trigger a JSON file download in the browser. */
export function downloadDeploymentPlan(plan: DeploymentPlan, filename?: string) {
  const safeLabel = plan.baseline.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const stamp = plan.generatedAt.slice(0, 10);
  const fname = filename ?? `ca-deployment-plan-${safeLabel || "baseline"}-${stamp}.json`;
  const blob = new Blob([JSON.stringify(plan, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Returns one map { filename: jsonString } for future ZIP export. */
export function deploymentPlanToFileMap(
  plan: DeploymentPlan
): Record<string, string> {
  const files: Record<string, string> = {
    "deployment-plan.json": JSON.stringify(plan, null, 2),
    "README.md": [
      "# CA Deployment Plan",
      "",
      `Generated by ${plan.generator.name} v${plan.generator.version} on ${plan.generatedAt}.`,
      `Baseline: **${plan.baseline.label}** (${plan.baseline.templateCount} templates, current coverage ${plan.baseline.coverageScore}/100).`,
      "",
      `## Totals`,
      "",
      `- Missing: ${plan.totals.missing}`,
      `- Drift: ${plan.totals.drift}`,
      `- Total to deploy: ${plan.totals.total}`,
      "",
      `## Instructions`,
      "",
      ...plan.instructions.map((i) => `- ${i}`),
      "",
      `## Policies`,
      "",
      ...plan.policies.map(
        (p, i) =>
          `${i + 1}. **[${p.severity.toUpperCase()}] ${p.templateDisplayName}** (${p.persona}, ${p.reason}) — ${p.summary}`
      ),
    ].join("\n"),
  };

  for (const p of plan.policies) {
    const safeId = p.templateId.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    files[`policies/${p.persona}/${safeId}.json`] = JSON.stringify(p.body, null, 2);
  }

  return files;
}
