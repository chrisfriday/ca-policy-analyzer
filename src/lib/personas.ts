/**
 * Zero Trust Persona Framework
 *
 * Based on Claus Jespersen's Conditional Access for Zero Trust persona model:
 * - https://github.com/microsoft/ConditionalAccessforZeroTrustResources
 * - https://learn.microsoft.com/entra/identity/conditional-access/plan-conditional-access
 *
 * Community baselines that follow this framework:
 * - Kenneth van Surksum: https://github.com/kennethvs/cabaseline202510
 * - Joey Verlinden:      https://github.com/j0eyv/ConditionalAccessBaseline
 *
 * The framework segments identities into ~8 personas, each with its own bundle
 * of CA policies. Naming conventions typically encode the persona in the policy
 * displayName (e.g. "CA101-Admins-Identity-MFA-AnyApp", "CA201-Internals-...").
 */

export type Persona =
  | "global"
  | "admins"
  | "internals"
  | "externals"
  | "guestadmins"
  | "developers"
  | "corpserviceaccounts"
  | "workloadidentities"
  | "microsoft365serviceaccounts"
  | "unknown";

export interface PersonaMeta {
  id: Persona;
  label: string;
  shortLabel: string;
  emoji: string;
  /** Color hint for UI (Tailwind class fragment) */
  color: string;
  /** What this persona covers and why it matters */
  description: string;
  /** Controls expected to be present for this persona */
  expectedControls: PersonaControl[];
}

export type PersonaControl =
  | "block-legacy-auth"
  | "require-mfa"
  | "require-compliant-device"
  | "sign-in-risk"
  | "user-risk"
  | "session-sif"
  | "block-countries"
  | "phishing-resistant-mfa"
  | "block-non-corp-network"
  | "block-high-risk-apps";

export const PERSONA_ORDER: Persona[] = [
  "global",
  "admins",
  "internals",
  "externals",
  "guestadmins",
  "developers",
  "corpserviceaccounts",
  "workloadidentities",
  "microsoft365serviceaccounts",
  "unknown",
];

export const PERSONA_META: Record<Persona, PersonaMeta> = {
  global: {
    id: "global",
    label: "Global",
    shortLabel: "Global",
    emoji: "🌐",
    color: "blue",
    description:
      "Tenant-wide baseline policies that apply to all users (block legacy auth, country blocks, terms of use).",
    expectedControls: ["block-legacy-auth", "block-countries"],
  },
  admins: {
    id: "admins",
    label: "Admins (Privileged Roles)",
    shortLabel: "Admins",
    emoji: "🛡️",
    color: "red",
    description:
      "Privileged directory role holders. Should require phishing-resistant MFA, compliant device, and tight session controls.",
    expectedControls: [
      "require-mfa",
      "phishing-resistant-mfa",
      "require-compliant-device",
      "sign-in-risk",
      "user-risk",
      "session-sif",
    ],
  },
  internals: {
    id: "internals",
    label: "Internals (Employees)",
    shortLabel: "Internals",
    emoji: "👤",
    color: "emerald",
    description:
      "Standard internal members. MFA, compliant device, sign-in risk and user risk policies expected.",
    expectedControls: [
      "require-mfa",
      "require-compliant-device",
      "sign-in-risk",
      "user-risk",
    ],
  },
  externals: {
    id: "externals",
    label: "Externals (B2B Guests)",
    shortLabel: "Externals",
    emoji: "🤝",
    color: "amber",
    description:
      "B2B collaboration guests and members from partner Entra tenants. MFA via auth strength (when home tenant trusts it) or basic MFA grant.",
    expectedControls: ["require-mfa"],
  },
  guestadmins: {
    id: "guestadmins",
    label: "Guest Admins (External Privileged)",
    shortLabel: "GuestAdmins",
    emoji: "🛡️🤝",
    color: "orange",
    description:
      "External admins (GDAP/CSP, partner privileged users). Require strong auth and tight session controls.",
    expectedControls: [
      "require-mfa",
      "phishing-resistant-mfa",
      "session-sif",
    ],
  },
  developers: {
    id: "developers",
    label: "Developers",
    shortLabel: "Developers",
    emoji: "💻",
    color: "purple",
    description:
      "Higher-privilege internal developers. Often need access to dev/test tenants and tooling — requires its own MFA + compliant device set.",
    expectedControls: [
      "require-mfa",
      "require-compliant-device",
      "user-risk",
    ],
  },
  corpserviceaccounts: {
    id: "corpserviceaccounts",
    label: "Corporate Service Accounts",
    shortLabel: "CorpSvc",
    emoji: "⚙️",
    color: "cyan",
    description:
      "User-mode service accounts that run automation. Should be locked to specific networks/locations and excluded from interactive MFA.",
    expectedControls: ["block-non-corp-network"],
  },
  workloadidentities: {
    id: "workloadidentities",
    label: "Workload Identities",
    shortLabel: "Workload",
    emoji: "🤖",
    color: "violet",
    description:
      "Service principals and managed identities. Require Workload Identities Premium and CA policies targeting servicePrincipals.",
    expectedControls: ["block-non-corp-network", "sign-in-risk"],
  },
  microsoft365serviceaccounts: {
    id: "microsoft365serviceaccounts",
    label: "Microsoft 365 Service Accounts",
    shortLabel: "M365Svc",
    emoji: "🔧",
    color: "slate",
    description:
      "Sync accounts (Entra Connect, on-prem hybrid). Excluded from MFA but locked to known locations.",
    expectedControls: ["block-non-corp-network"],
  },
  unknown: {
    id: "unknown",
    label: "Unclassified",
    shortLabel: "Unclassified",
    emoji: "❓",
    color: "gray",
    description:
      "Policies that do not match any known persona naming convention.",
    expectedControls: [],
  },
};

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * Token patterns that map to each persona. Order matters — more specific
 * patterns (e.g. "GuestAdmin") are tested before broader ones ("Guest").
 *
 * Match is case-insensitive, applied to the full displayName, and checks for
 * the token as a whole word (separated by ‐ – _ space or end of string).
 */
const PERSONA_PATTERNS: Array<{ persona: Persona; patterns: RegExp[] }> = [
  // Most specific first
  {
    persona: "microsoft365serviceaccounts",
    patterns: [
      /\b(microsoft365serviceaccounts?|m365service|m365svc|directorysynchronization|aadc?onnect|entraconnect)\b/i,
    ],
  },
  {
    persona: "workloadidentities",
    patterns: [
      /\b(workload[\s_-]?identit(?:y|ies)|workloadid|serviceprincipals?|managedidentit(?:y|ies))\b/i,
    ],
  },
  {
    persona: "corpserviceaccounts",
    patterns: [
      /\b(corp(?:orate)?serviceaccounts?|corpservice|corpsvc|svcaccounts?)\b/i,
    ],
  },
  {
    persona: "guestadmins",
    patterns: [
      /\b(guestadmins?|externaladmins?|gdap|cspadmins?|partneradmins?)\b/i,
    ],
  },
  {
    persona: "admins",
    patterns: [
      /\b(admins?|privilegedusers?|privrole|priv[\s_-]?roles?)\b/i,
    ],
  },
  {
    persona: "developers",
    patterns: [/\b(developers?|devs?|engineers?)\b/i],
  },
  {
    persona: "externals",
    patterns: [
      /\b(externals?|guests?|b2b|external[\s_-]?users?|externalcollabs?)\b/i,
    ],
  },
  {
    persona: "internals",
    patterns: [
      /\b(internals?|employees?|members?|staff|users?[\s_-]?internal)\b/i,
    ],
  },
  {
    persona: "global",
    patterns: [/\b(global|alluser|tenantwide|baseline|allapps?|allcloudapps?)\b/i],
  },
];

/**
 * Detect the persona for a given policy displayName by inspecting common
 * naming-convention tokens. Returns "unknown" if no match.
 */
export function detectPersona(displayName: string): Persona {
  if (!displayName) return "unknown";
  for (const { persona, patterns } of PERSONA_PATTERNS) {
    if (patterns.some((p) => p.test(displayName))) return persona;
  }
  return "unknown";
}

// ─── Known Baselines ─────────────────────────────────────────────────────────

export interface KnownBaseline {
  id: string;
  label: string;
  author: string;
  repoUrl: string;
  description: string;
  source: "claus" | "kenneth" | "joey";
}

/**
 * Curated list of well-known community CA baselines that follow the persona
 * framework. Surfaced as one-click "Load baseline" buttons in the Templates view.
 */
export const KNOWN_BASELINES: KnownBaseline[] = [
  {
    id: "kennethvs",
    label: "Kenneth van Surksum — Baseline 2025.10",
    author: "Kenneth van Surksum (MVP)",
    repoUrl: "https://github.com/kennethvs/cabaseline202510",
    description:
      "Community-maintained Zero Trust persona baseline, refreshed quarterly. Strong reference for production-grade tenants.",
    source: "kenneth",
  },
  {
    id: "joeyv",
    label: "Joey Verlinden — Conditional Access Baseline",
    author: "Joey Verlinden (MVP)",
    // Point at the Config/ root so the loader picks up the full restore bundle:
    // ConditionalAccess/ (67 policies) + Groups/ (33 exclusion groups) +
    // NamedLocations/ (allowed-countries lists) + MigrationTable.json.
    repoUrl:
      "https://github.com/j0eyv/ConditionalAccessBaseline/tree/main/Config",
    description:
      "Persona-based baseline aligned with Microsoft's Zero Trust guidance and Claus Jespersen's framework. Includes a full DCToolbox-style restore bundle (policies + exclusion groups + named locations + migration table).",
    source: "joey",
  },
];

/**
 * Reference-only sources (not loaded as baselines, credited in docs).
 * Claus Jespersen's repo is the canonical framework reference but is no longer
 * actively maintained as a deployable baseline — cite for guidance only.
 */
export const REFERENCE_SOURCES = [
  {
    id: "clajes",
    label: "Claus Jespersen — Microsoft Zero Trust framework (reference)",
    author: "Claus Jespersen (Microsoft)",
    repoUrl:
      "https://github.com/microsoft/ConditionalAccessforZeroTrustResources",
    description:
      "Original Microsoft persona framework reference. Cite for guidance — not actively maintained as a deployable baseline.",
  },
] as const;
