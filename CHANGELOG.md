# Changelog

All notable changes to the CA Policy Analyzer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.14.3] - 2026-05-08

### Fixed

- **Tenant-wide MFA Coverage finding — report-only awareness** — the *"No policy requires MFA for All Users"* finding under `checkTenantWideGaps()` previously fired as **critical** whenever no `state === "enabled"` policy targeted All Users with MFA, even when a fully-formed **report-only** (`enabledForReportingButNotEnforced`) policy already covered the case. Operators with policies like `IAC - GLOBAL - GRANT - MFA - AllUsers` running in report-only mode were getting a misleading critical finding that read *"No enabled policy was found..."*.
  - Check now scans both `enabled` and `enabledForReportingButNotEnforced` states.
  - When only a report-only policy covers MFA-for-All-Users, the finding is rewritten as **"MFA for All Users exists but is Report-only"**, severity is downgraded **critical → medium**, the finding now references the actual policy id and name (instead of `tenant-wide`), and the recommendation guides the operator to promote after 7–14 days of telemetry observation.
  - The original critical finding still fires when neither enabled nor report-only coverage exists.
- Helper `isMfaForAll(policy)` extracted in [src/lib/analyzer.ts](src/lib/analyzer.ts) so the check is reused for both the enabled and report-only scans.

## [1.14.2] - 2026-05-08

### Fixed

- **Zero Trust scorecard — phishing-resistant MFA detection** — the "Phishing-resistant MFA in use" signal under the *Verify Explicitly* pillar previously only matched the `displayName` of the authentication strength against a regex. Custom strengths (e.g. `Modern MFA + TAP`) that **contain** FIDO2 / Windows Hello for Business / x509 certificate MFA combinations were missed even though they are phishing-resistant.
  - The detection now resolves the policy's `authenticationStrength.id` against the tenant's authentication-strength catalog (`TenantContext.authStrengthPolicies`) and inspects `allowedCombinations` directly. Tokens treated as phishing-resistant: `fido2`, `windowsHelloForBusiness`, `x509CertificateMultiFactor`, `x509CertificateSingleFactor`, `deviceBoundPasskey`, `hardwareOath`.
  - Also matches the well-known built-in **Phishing-resistant MFA** strength id `00000000-0000-0000-0000-000000000004` directly.
  - The displayName regex is kept as a defensive fallback for snapshots where the strength catalog hadn't loaded.
  - Evidence string now names the matching strength, e.g. *"1 policy uses a phishing-resistant auth strength (e.g. \"Modern MFA + TAP\")."*
- New helper `policyUsesPhishingResistant(policy, context)` in [src/lib/zero-trust-scorecard.ts](src/lib/zero-trust-scorecard.ts).

## [1.14.1] - 2026-05-08

### Changed — Phase 5 deployment plan now ships as a ZIP bundle

- The "Download deployment plan" button on the **Baseline Gap** tab now produces a **ZIP bundle** (`ca-deployment-plan-<baseline>-<date>.zip`) instead of a single JSON file. The ZIP contains:
  - `README.md` — human-readable instructions, ordered by **Zero Trust criticality** (Critical → High → Medium → Low). Within each tier, personas appear in the canonical Zero Trust order from `PERSONA_ORDER` (Global → Admins → Internals → Externals → Guest Admins → Developers → CorpServiceAccounts → WorkloadIdentities). Each policy entry links to its own JSON file on disk.
  - `deployment-plan.json` — the original machine-readable manifest (unchanged shape, schema v1) — useful for scripted iteration in PowerShell.
  - `policies/<persona>/<template>.json` — one Graph-ready `ConditionalAccessPolicy` body per file, suitable for direct upload via Graph PowerShell, DCToolbox, `Invoke-MgGraphRequest`, or `curl`.
- `src/lib/deployment-plan.ts` adds `downloadDeploymentBundle(plan)` which builds the ZIP via [JSZip](https://stuk.github.io/jszip/) and triggers a browser download. The legacy single-file `downloadDeploymentPlan()` is still exported for any consumers that prefer raw JSON, but the UI button no longer uses it.
- The README inside the bundle bakes in **four auto-import recipes** (Microsoft Graph PowerShell SDK, DCToolbox, `Invoke-MgGraphRequest`, and Bash + curl + jq) so the operator can pick whichever fits their workflow without leaving the bundle.
- Bundle layout is documented in the README's "Bundle layout" section so the operator can selectively deploy a single persona by importing only that subdirectory.

### Dependencies
- Add **`jszip ^3.10.1`** for ZIP creation in the browser.

## [1.14.0] - 2026-05-08

### Added — Zero Trust Persona Framework — Phases 5 & 6

#### Phase 5 — Deployment Plan Generator
- New module [src/lib/deployment-plan.ts](src/lib/deployment-plan.ts) converts the **Baseline Gap** report into a Graph-ready import bundle:
  - `buildDeploymentPlan(gaps, templateResult, baselineLabel)` — emits a `DeploymentPlan` (schemaVersion 1) containing every *missing* and *drift* entry with the template's full `deploymentJson` body (conditions / grantControls / sessionControls), the originating persona, severity, and the reason for inclusion
  - **Every body's `state` is forced to `disabled`** before write — operators must explicitly enable each policy in their tenant after review
  - Bundles built-in **PowerShell + DCToolbox import recipes** in `PLAN_INSTRUCTIONS` so the JSON is self-documenting
  - `deploymentPlanToFileMap(plan)` produces a `{path: content}` map ready for future ZIP packaging (`deployment-plan.json`, `README.md`, `policies/<persona>/<id>.json`)
  - Tenant-only entries are skipped (nothing to deploy from a custom tenant policy back into a baseline)
- **"Download deployment plan"** button added to [src/components/baseline-gap-view.tsx](src/components/baseline-gap-view.tsx) — visible only when both a template result is loaded and at least one missing/drift entry exists; clicking exports a single JSON via `Blob` + `URL.createObjectURL`

#### Phase 6 — Persona-aware PowerPoint export
- [src/lib/export-utils.ts](src/lib/export-utils.ts) `exportToPowerPoint` now accepts optional `personaResult`, `scorecard`, and `baselineGap` arguments and inserts new slides between the policy slides and the CIS slide:
  - **Zero Trust Scorecard slide** — three rounded-rect pillar cards (Verify Explicitly / Least Privilege / Assume Breach) with the pillar score color-coded (green ≥80, yellow ≥50, red <50) and the top 5 signals listed underneath each pillar with score + evidence
  - **Persona × Control Coverage summary slide** — table of every persona that has at least one assigned policy with columns *Persona / Policies / Score / Present / Partial / Missing*
  - **Per-persona detail slides** — one slide per persona that has assigned policies *or* baseline gaps, each showing the persona's score badge, a 5-card stat strip (Assigned / Enabled / Present / Partial / Missing), a left-column table listing the persona's controls (sorted missing → partial → present, top 10) and a right-column gap section with Missing / Drift / Tenant-only counts plus the top 6 gap entries sorted by severity
  - **Baseline Gap slide** — top stat row (Missing / Drift / Tenant-only / Coverage %) plus per-persona table *Persona / Missing / Drift / Tenant-only / Total*
- The full Zero Trust framework story (pillars → persona summary → per-persona deep-dives → baseline gap) now flows through to the executive deck automatically when the source data is available
- Wired into [src/app/page.tsx](src/app/page.tsx) PPTX export call

### Changed
- `runAnalysis` in [src/app/page.tsx](src/app/page.tsx) now tracks the active template result in a local `activeTemplates` variable so subsequent analysis steps (composite scoring, baseline gap) consume the most recent template set without waiting for React state to flush
- `BaselineGapView` accepts a new optional `templateResult` prop; the deployment-plan download button only appears when this prop is supplied

## [1.13.0] - 2026-05-08

### Added
- **Zero Trust Persona Framework — Phase 4: Baseline Gap Analysis** — new top-level **Baseline Gap** tab that diffs the live tenant against a *loaded* Zero Trust baseline (Kenneth, Joey, custom GitHub repo, or the built-in template set):
  - New analyzer [src/lib/baseline-gap.ts](src/lib/baseline-gap.ts) reclassifies the existing `TemplateAnalysisResult` into three actionable buckets:
    - **Missing** — baseline policy with no tenant equivalent (severity tracks the template priority: critical/recommended/optional → critical/high/medium)
    - **Drift** — baseline policy is partially matched in the tenant; differences are surfaced inline (closest tenant policy name + every diff the matcher already detected)
    - **Tenant-only** — enabled tenant policy that doesn’t map to any baseline template (potential custom policy, drift, or coverage gap in the baseline itself)
  - **Persona-bucketed output** — every gap is grouped by Zero Trust persona using the same `detectPersona` heuristics as Phase 1–3, so the operator sees “Admins is missing 3 baseline policies and has 2 unaccounted-for tenant policies” at a glance
  - **Coverage score** 0–100 = `(present + 0.5 × partial) / applicable_templates` — a single number that tracks how closely the tenant follows the loaded baseline
  - New view component [src/components/baseline-gap-view.tsx](src/components/baseline-gap-view.tsx) with toggleable Missing/Drift/Tenant-only filters, persona-grouped expandable cards, severity badges, and per-entry evidence drawers
  - Lazy-derived via `useMemo` from `(context, templateResult)` — zero extra Graph calls; recomputes automatically when the user loads a different baseline via “Compare Custom Repo”
  - Tab is hidden until both context and a template result are available, so the surface area only appears when there’s something to diff

### Changed
- New tab key `baseline` (between `templates` and `cis`) added to `ViewTab`; `lucide-react` `GitCompareArrows` icon used as the tab affordance

## [1.12.0] - 2026-05-08

### Added
- **Zero Trust Persona Framework — Phase 3: Zero Trust Scorecard** — new dashboard widget that scores the tenant against [Microsoft's three Zero Trust principles](https://learn.microsoft.com/security/zero-trust/zero-trust-overview):
  - New analyzer [src/lib/zero-trust-scorecard.ts](src/lib/zero-trust-scorecard.ts) — rolls up evidence from `analyzeAllPolicies` + `analyzePersonaCoverage` into 15 weighted signals across 3 pillars (no extra Graph calls, no double-counting)
  - **Verify Explicitly** (5 signals): MFA coverage of enabled policies, phishing-resistant authentication strengths in use, compliant/Hybrid-joined device requirements, risk signals consumed (sign-in/user/named-locations), Admins MFA per persona coverage
  - **Use Least Privilege** (5 signals): persona segmentation (admins vs internals vs externals), privileged-role exclusions (inverse of analyzer findings), policy scope (penalizes `users=All ∧ apps=All ∧ no-controls`), break-glass account presence, FOCI / token-theft risk findings (inverse)
  - **Assume Breach** (5 signals): legacy auth blocked, sign-in risk policies, user risk policies, session controls (sign-in frequency / persistent browser), open critical+high findings backlog (inverse)
  - Each signal has a 0–100 score, a weight (1–3), an evidence string, and a status (good ≥80, warn ≥50, bad <50, n/a when not applicable)
  - Pillar score = weighted average of non-N/A signals; Overall = simple average of the three pillars
  - New view component [src/components/zero-trust-scorecard.tsx](src/components/zero-trust-scorecard.tsx) — three pillar cards with color-coded score, progress bar, and click-to-expand signal breakdown showing every input that fed the pillar
  - Renders at the top of the **Dashboard** tab so posture against the three principles is the first thing you see after analysis

### Changed
- `Dashboard` component now accepts an optional `scorecard` prop and renders the Zero Trust card above the existing score ring + finding-severity breakdown
- `runAnalysis` in [src/app/page.tsx](src/app/page.tsx) calls `buildZeroTrustScorecard(ctx, mergedResult, persona)` after composite scoring so the persona-merged finding set feeds the Assume-Breach backlog signal

## [1.11.0] - 2026-05-07

### Added
- **Zero Trust Persona Framework — Phase 2: Persona × Control Coverage** — new top-level **Personas** tab that scores the tenant against the required-control matrix defined in [src/lib/personas.ts](src/lib/personas.ts):
  - New analyzer [src/lib/persona-coverage.ts](src/lib/persona-coverage.ts) buckets every CA policy into one or more personas (by displayName, plus structural fallbacks: `includeUsers=All` → Global+Internals, `includeRoles` populated → Admins, `includeGuestsOrExternalUsers` → Externals)
  - Detects 10 required controls per persona — `block-legacy-auth`, `require-mfa`, `require-compliant-device`, `sign-in-risk`, `user-risk`, `session-sif`, `block-countries`, `phishing-resistant-mfa`, `block-non-corp-network`, `block-high-risk-apps`
  - Each control gets a status of **Present** (enabled policy enforces it), **Report-only** (only enforced in report-only mode), **Missing**, or **N/A**
  - Per-persona score card with overall coverage ring, expandable control breakdown, and a list of every policy assigned to that persona (with state)
  - **Critical gaps surface as findings** in the Findings tab and exports — Admins missing MFA → critical; Internals missing user-risk → medium; etc. Severity is tuned per persona × control pair
- New view component [src/components/persona-view.tsx](src/components/persona-view.tsx) with persona cards, status badges, and expandable per-control evidence (which policies enforce / report-only enforce each control)

### Changed
- `analyzeAllPolicies` results now include the persona-coverage findings merged into `result.findings` so every existing surface (Findings list, Excel/PowerPoint export, dashboard counts) sees the new gap detections without duplicate analyzer runs

## [1.10.2] - 2026-05-07

### Fixed
- **Joey Verlinden baseline now actually loads (real fix)** — files were UTF-16 LE, not UTF-8 with BOM. The fetcher now reads response bodies as `ArrayBuffer` and sniffs the BOM to pick the right `TextDecoder` (UTF-16 LE / UTF-16 BE / UTF-8 with or without BOM). PowerShell `ConvertTo-Json | Out-File` on Windows defaults to UTF-16 LE, which produced mojibake when decoded as UTF-8.

### Added
- **Restore-bundle awareness** — the GitHub loader now recognizes the full DCToolbox-style export structure (CA policies + `Groups/` + `NamedLocations/` + `MigrationTable.json`):
  - Each fetched JSON is classified as `capolicy`, `group`, `namedlocation`, `migrationtable`, or `unknown` based on file path, `@odata.type`, `@odata.context`, and shape — companion files no longer get reported as "invalid CA policy exports"
  - Companion artifacts are collected into a `BaselineBundle` (group id → displayName, named-location id → displayName, migration-table presence) returned alongside the templates for future GUID-resolution work
  - Status message now reports the full bundle, e.g. `Loaded 67 policies + 33 groups + 2 named locations + migration table.`
- New exported types: `BaselineBundle`, extended `GitHubTemplateResult` with optional `bundle` field

### Changed
- **Joey Verlinden preset now points at [`Config/`](https://github.com/j0eyv/ConditionalAccessBaseline/tree/main/Config)** (parent folder) instead of `Config/ConditionalAccess` so the loader picks up the full restore bundle automatically

## [1.10.1] - 2026-05-07

### Fixed
- **Joey Verlinden baseline now loads correctly** — github-templates fetcher now strips UTF-8 BOM (PowerShell `ConvertTo-Json | Out-File` writes a leading BOM that broke `JSON.parse`)
- **Broader CA policy validation** — accept any export with `displayName` + `conditions` object (previously required non-null `conditions.users` or `conditions.applications`, which rejected baselines with minimal condition blocks)
- Joey Verlinden preset URL now deep-links to [`Config/ConditionalAccess`](https://github.com/j0eyv/ConditionalAccessBaseline/tree/main/Config/ConditionalAccess)

### Changed
- **Removed Claus Jespersen preset button** — repo is the canonical Zero Trust framework reference but is no longer actively maintained as a deployable baseline. Credited as a guidance reference in [docs/zero-trust-persona-framework.md](docs/zero-trust-persona-framework.md) only.

## [1.10.0] - 2026-05-07

### Added
- **Zero Trust Persona Framework (Phase 1)** — Adds persona-based intelligence to the Templates tab, aligned with [Claus Jespersen's Microsoft framework](https://github.com/microsoft/ConditionalAccessforZeroTrustResources) and the [Welkasworld design guide](https://www.welkasworld.com/post/conditional-access-naming-conventions-personas-design-process)
  - **Persona detection** from policy `displayName`: Global, Admins, Internals, Externals, GuestAdmins, Developers, CorpServiceAccounts, WorkloadIdentities, Microsoft365ServiceAccounts
  - **One-click baseline loading** — Three preset buttons in the GitHub repo input load community Zero Trust baselines:
    - Kenneth van Surksum — [`cabaseline202510`](https://github.com/kennethvs/cabaseline202510)
    - Joey Verlinden — [`ConditionalAccessBaseline`](https://github.com/j0eyv/ConditionalAccessBaseline)
    - Claus Jespersen — [`ConditionalAccessforZeroTrustResources`](https://github.com/microsoft/ConditionalAccessforZeroTrustResources)
  - **Persona-based grouping** — When a loaded repo uses persona naming (Admins, Internals, Externals, Workload, etc.), policies group by persona automatically with persona descriptions and expected control hints. Falls back to existing CAD/CAL/CAP prefix grouping otherwise.
  - **New reference doc** — [docs/zero-trust-persona-framework.md](docs/zero-trust-persona-framework.md) consolidating persona taxonomy, naming conventions, expected control bundle per persona, and references to Welkasworld, Claus Jespersen, and community baselines.

### Roadmap
- **Phase 2** — Persona × required-control coverage matrix as a tenant-wide analyzer finding
- **Phase 3** — Zero Trust pillar scorecard (Verify Explicitly / Least Privilege / Assume Breach) on the dashboard
- **Phase 4** — Gap analysis comparing tenant against a chosen baseline (Kenneth / Joey / Claus)

## [1.9.0] - 2026-04-17

### Added
- **Custom GitHub Template Comparison** — Compare your tenant policies against any public GitHub repository containing CA policy JSON exports
  - New "Compare Custom Repo" button on the Templates tab
  - Accepts GitHub URLs (`https://github.com/owner/repo`) or shorthand (`owner/repo`)
  - Supports deep links to specific branches/paths (`/tree/main/Policies`)
  - Auto-detects JSON files in root or common subdirectories (`Policies/`, `policies/`, `CA/`)
  - Converts Graph API CA policy JSON into templates with auto-generated fingerprints
  - Re-runs the template matching engine against custom templates
  - Shows custom repo attribution with "Back to default" reset button
- **Persistent custom repo across refreshes** — Selected GitHub repo URL saved to localStorage and auto-restored on next analysis run
- **Prefix-based grouping for custom repos** — Custom repo templates grouped by naming prefix (CAD, CAL, CAP…) instead of Foundation/Baseline categories, sorted numerically within each group

### Changed
- **Privileged Role Exclusion check now detects compensating policies** — When admin roles are excluded from an MFA policy, the analyzer checks if another enabled policy covers those roles with MFA or authentication strength. If covered, severity drops from critical/high to info with a note identifying the covering policy.

### Fixed
- **Break-glass severity for disabled/report-only policies** — Disabled policies missing break-glass raised from info → **low**, report-only raised from info → **medium**
- **Entra Connect version corrected** — DirSync app-based auth was introduced in v2.5.76.0, not v2.5.79
- **DirSync check now links to version history** — `docUrl` updated to the [Entra Connect version history](https://learn.microsoft.com/entra/identity/hybrid/connect/reference-connect-version-history) article

## [1.8.0] - 2026-04-11

### Added
- **Per-Policy Break-Glass Annotations** — Every Conditional Access policy now shows whether the break-glass account/group is excluded
  - Fires on ALL policies in the tenant, not just the 7 critical policy types
  - Severity-aware annotations:
    - **Info**: Break-glass excluded ✓ (positive confirmation)
    - **High**: NOT excluded on block + all users + all apps policies
    - **Medium**: NOT excluded on MFA / compliance + all users policies
    - **Low**: NOT excluded on other enabled policies
    - **Medium**: NOT excluded on report-only policies (will block break-glass once switched to enabled)
    - **Low**: NOT excluded on disabled policies (will block break-glass if enabled without adding exclusion)
    - **Info**: Disabled Microsoft managed policies show guidance to add before enabling
  - Skips workload-identity-only policies (no user targeting)
  - Resolves display names for break-glass accounts/groups from directory objects

### Changed
- **Tenant-Wide Break-Glass Summary — Now shows total policy coverage counts**
  - Title shows "X of Y policies" with total tenant policy count
  - Description includes full breakdown: total policies, user-targeting policies, with/without break-glass counts
  - Lists specific policies missing break-glass exclusions
  - Extracted break-glass identification into reusable `identifyBreakGlass()` helper shared by per-policy and tenant-wide checks
  - Removed duplicate identification logic (Steps 1–5) from tenant-wide section

### Fixed
- **CIS MS Learn Link Audit — 7 controls had wrong articles** (links were shifted between neighboring controls)
  - **5.3.3** (Guest MFA): Was "Block legacy auth" → Now [Require MFA for external users](https://learn.microsoft.com/entra/identity/conditional-access/policy-guest-mfa-strength)
  - **5.3.5** (MFA for device registration): Was "Sign-in risk" → Now [Require MFA for device registration](https://learn.microsoft.com/entra/identity/conditional-access/policy-all-users-device-registration)
  - **5.3.6** (Sign-in risk): Was "User risk" → Now [Sign-in risk-based CA policy](https://learn.microsoft.com/entra/identity/conditional-access/policy-risk-based-sign-in)
  - **5.3.9** (Legacy auth block): Was "Require MFA for device registration" → Now [Block legacy authentication](https://learn.microsoft.com/entra/identity/conditional-access/policy-block-legacy-authentication)
  - **5.3.12** (Device code flow): Was "Compliant device for admins" → Now [Block device code flow](https://learn.microsoft.com/entra/identity/conditional-access/policy-block-device-code-flow)
  - **5.4.1** (High-risk users): Was linking to sign-in risk article → Now [Block access for high-risk users](https://learn.microsoft.com/entra/identity/conditional-access/policy-risk-based-user)
  - **5.4.2** (High-risk sign-ins): Was linking to user risk article → Now [Block access for high-risk sign-ins](https://learn.microsoft.com/entra/identity/conditional-access/policy-risk-based-sign-in)
  - **5.4.5** (App protection): Was linking to device-compliance URL → Now [Require app protection policy](https://learn.microsoft.com/entra/identity/conditional-access/policy-all-users-app-protection)

## [1.7.0] - 2026-04-11

### Changed
- **Resource Exclusion Bypass Check — Updated for March 2026 Enforcement Change**
  - Microsoft is rolling out CA enforcement for low-privilege scopes (March-June 2026) that were previously exempt
  - Updated check from "scopes are leaked" (HIGH) to transitional enforcement awareness (MEDIUM)
  - Previously excluded scopes (`User.Read`, `openid`, `profile`, `email`, `offline_access`, `People.Read`) are now enforced via Azure AD Graph as the enforcement audience
  - **Added missing confidential client scopes** that had a broader bypass (not previously tracked):
    - `User.Read.All`, `User.ReadBasic.All` — directory user enumeration
    - `People.Read.All` — organizational relationship data
    - `GroupMember.Read.All` — security group membership enumeration
    - `Member.Read.Hidden` — hidden group membership reads
  - Updated `RESOURCE_EXCLUSION_BYPASSES` data model with `enforcementStatus`, `enforcementAudience`, and `confidentialClientScopes` fields
  - Severity reduced from HIGH to MEDIUM since Microsoft is actively remediating the bypass
  - References: [CA behavior change](https://learn.microsoft.com/entra/identity/conditional-access/concept-conditional-access-cloud-apps#new-conditional-access-behavior-when-an-all-resources-policy-has-a-resource-exclusion)

### Added
- **Low-Privilege Scope Enforcement Tenant-Wide Check** — New finding category
  - Detects policies with "All resources" targeting that have app exclusions affected by the enforcement rollout
  - Identifies whether tenant has explicit Azure AD Graph policy coverage
  - Warns about apps that may receive unexpected CA challenges (MFA, device compliance) during rollout
  - Recommends reviewing Usage & Insights report and sign-in logs filtered by Azure AD Graph resource
  - Advises updating custom apps not designed for CA claims challenges
  - Added "Low-Privilege Scope Enforcement" category with yellow AlertTriangle icon

### Fixed
- **Workload Identity Premium License Detection** — Now detects both `AAD_WRKLDID_P1` and `AAD_WRKLDID_P2` service plan IDs
  - Previously only checked `84c289f0-efcb-486f-8581-07f44fc9efad` (P1 plan from `Workload_Identities_Premium_CN` SKU)
  - Now also checks `7dc0e92d-bf15-401d-907e-0884efe7c760` (P2 plan from `Workload_Identities_P2` SKU)
  - Tenants with the standalone `Microsoft Entra Workload ID` license were incorrectly showing "not detected"

## [1.6.0] - 2026-04-11

### Enhanced
- **Guest/External User Exclusion Check** - Improved clarity on guest type enforcement models
  - Now shows which specific guest types are excluded from policies
  - Clearly explains which types can be enforced in the resource tenant (B2B Collaboration guests/members) vs home tenant only (B2B Direct Connect users)
  - Categorizes excluded types by enforcement model: Resource tenant enforceable, Home tenant only, Other external users
  - Explains MFA trust requirements in Cross-Tenant Access Settings for B2B Collaboration guests
  - Notes that B2B Direct Connect users authenticate in their home tenant and cannot be directly controlled
  - More actionable recommendations based on which guest types are at risk

#### Guest / External User MFA Enforcement Model

> 📘 **Full reference:** see [docs/external-user-mfa-reference.md](docs/external-user-mfa-reference.md) for per-type detail, supported method tables, and authentication strength matrix.

Where MFA completes depends on **two** things: (1) whether the user authenticates via Entra ID, and (2) whether inbound cross-tenant MFA trust is configured. Without trust, even Entra-backed B2B guests complete MFA at the resource tenant — the home tenant path is opt-in.

| CA External User Type | Identity Provider | MFA Enforced By | Auth Strength Support | Cross-Tenant Trust Required |
|---|---|---|---|---|
| **Local / Internal Guest** (`internalGuest`) | Your own tenant | Resource tenant — always | ✅ Full method set | No |
| **B2B Collab Guest** (`b2bCollaborationGuest`) — Entra-backed | External Entra tenant | Either (trust-dependent) | ✅ Supported | Optional (enables home tenant path) |
| **B2B Collab Guest** (`b2bCollaborationGuest`) — non-Entra | Google / OTP / SAML / WS-Fed | Resource tenant — always | ❌ NOT supported (use basic `mfa`) | N/A |
| **B2B Collab Member** (`b2bCollaborationMember`) | External Entra tenant | Either (trust-dependent) | ✅ Supported | Optional (enables home tenant path) |
| **B2B Direct Connect** (`b2bDirectConnectUser`) | External Entra tenant | Home tenant — mandatory | ✅ Supported (home methods only) | **REQUIRED** (else blocked) |
| **Service Provider** (`serviceProvider`) — GDAP/CSP | Partner Entra tenant | Home tenant — always | Partial (home methods only) | Auto-trusted by Microsoft |
| **Other External** (`otherExternalUser`) | Non-Entra | Resource tenant — always | ❌ NOT supported (use basic `mfa`) | N/A |

> ⚠️ **Heterogeneity warning:** `b2bCollaborationGuest` contains BOTH Entra-backed and non-Entra guests. CA cannot filter within this type by IdP. If your guest population is mixed, use the basic `mfa` grant control — authentication strength will **block** non-Entra guests instead of prompting them.
>
> ⚠️ **Auth strength hard line:** non-Entra IdP users (Google, email OTP, SAML/WS-Fed) cannot satisfy authentication strength regardless of which CA user type they land under. Phishing-resistant methods (FIDO2, WHfB, CBA, OATH hardware) are only usable from the **home tenant** — inbound MFA trust must be configured to use them.

### Added
- **Comprehensive Break-Glass Account Review** - New tenant-wide analysis to validate emergency access protection
  - Automatically identifies break-glass accounts or groups by analyzing exclusion patterns across policies
  - Distinguishes between user-based and group-based break-glass strategies
  - Validates break-glass exclusions are present in all critical policies (MFA, blocks, security registration, protected actions)
  - Special handling for Microsoft managed policies: Allows omission of break-glass if policy is disabled
  - Three severity levels:
    - CRITICAL: No break-glass detected anywhere in tenant
    - HIGH: Break-glass identified but missing from some critical policies
    - INFO: Break-glass properly excluded from all critical policies ✓
  - Provides targeted guidance based on findings:
    - If no break-glass: Step-by-step instructions to create 2 emergency access accounts
    - If partial coverage: Lists specific policies missing break-glass exclusions
    - If full coverage: Ongoing maintenance recommendations
  - Includes best practices: Cloud-only accounts, 16+ char passwords, no mailboxes, Azure Monitor alerts, quarterly testing
  - Links to Microsoft Learn articles on emergency access account management
  - References: [Manage emergency access accounts](https://learn.microsoft.com/entra/identity/role-based-access-control/security-emergency-access)

## [1.5.0] - 2026-04-06

### Added
- **Identity Protection Risk-Based Checks** - New tenant-wide checks for Identity Protection integration
  - Detects missing user risk policies (high-risk users not blocked or required to change password)
  - Detects missing sign-in risk policies (risky sign-ins not requiring MFA)
  - Explains risk indicators: leaked credentials, anomalous behavior, TOR/VPN usage, impossible travel
  - Provides Azure AD Premium P2 requirements and policy configuration guidance
  - Severity: HIGH for missing risk-based policies
  - Reference: [Identity Protection Overview](https://learn.microsoft.com/entra/id-protection/overview-identity-protection)
- **High-Value Application Coverage Check** - Validates MFA/blocking policies for critical Microsoft apps
  - Detects unprotected access to Azure Management, Azure Portal, Microsoft Graph, Exchange, SharePoint
  - Flags applications by risk level: CRITICAL (Azure, Graph) and HIGH (Office 365 services)
  - Recommends phishing-resistant MFA for Azure management and API access
  - Provides app-specific policy configuration guidance
  - Severity: CRITICAL if Azure/Graph unprotected, HIGH for Office 365 apps
  - Reference: [Application-specific CA policies](https://learn.microsoft.com/entra/identity/conditional-access/concept-conditional-access-cloud-apps)
- **New Finding Categories**: "Identity Protection" and "Application Coverage" with ShieldAlert icon (red)

## [1.4.0] - 2026-04-04

### Added
- **Protected Actions Configuration Check** - New analyzer check that validates Protected Actions policies for security best practices
  - Detects policies using basic MFA instead of required authentication strength for Protected Actions
  - Identifies policies targeting "All users" instead of specific admin roles who perform protected actions
  - Recommends phishing-resistant MFA for sensitive operations (delete CA policies, role management, app changes)
  - Validates break-glass account exclusions to prevent emergency access lockouts
  - Identifies policies in report-only mode that should be enabled for enforcement
  - Provides detailed guidance on authentication strength requirements and admin role scoping
  - Reference: [Protected Actions for Conditional Access](https://learn.microsoft.com/entra/identity/conditional-access/how-to-policy-protected-actions)
- **New Finding Category** - "Protected Actions Configuration" with Shield icon (purple) in UI

- **Guest Authentication Strength Check** - New analyzer check that detects policies requiring authentication strength (especially phishing-resistant MFA) for guest/external users
  - Identifies when policies target guest users with MFA or authentication strength requirements
  - Warns that guest users authenticate in their home tenant and require Cross-Tenant Access Settings configuration
  - Distinguishes between B2B Collaboration guests, B2B Direct Connect users, and other guest types
  - Provides severity levels: HIGH for phishing-resistant requirements, MEDIUM for standard MFA
  - Includes detailed guidance on enabling inbound MFA trust in Cross-Tenant Access Settings
  - Links to Microsoft Learn documentation on B2B collaboration authentication and cross-tenant access
  - Reference: [Configure Cross-Tenant Access Settings](https://learn.microsoft.com/entra/external-id/cross-tenant-access-settings-b2b-collaboration)
- **New Finding Category** - "Guest Authentication Requirements" with AlertTriangle icon (orange) in UI

### Context

Guest users in Microsoft Entra authenticate in their home tenant, not the resource tenant. When Conditional Access policies require MFA or authentication strength for guests, the resource tenant must trust inbound MFA claims via Cross-Tenant Access Settings. Without this trust enabled, guest users will be blocked even if they completed MFA in their home tenant. This check helps organizations identify these configurations and provides step-by-step remediation guidance.

### Technical Details

- Added `checkGuestAuthenticationStrength()` function to `src/lib/analyzer.ts`
- Added `checkProtectedActions()` function to `src/lib/analyzer.ts`
- Updated `src/components/findings-list.tsx` with new category metadata
- Detects both authentication strength policies and standard MFA requirements targeting guests
- Analyzes `includeGuestsOrExternalUsers` conditions to identify specific guest types affected

---

## [1.3.0] - 2026-04-04

### Added

- **Windows Hello / Platform SSO Registration Constraint Check** - Identifies CA policies that may block Windows Hello for Business and macOS Platform SSO credential provisioning starting May 2026
  - Validates policies targeting "Register security info" user action
  - Flags report-only policies requiring activation before enforcement
  - Checks for overly restrictive location/compliance requirements incompatible with DRS
  - Severity adjusts based on policy state and control configuration


### Context

Starting May 2026, Microsoft will enforce Conditional Access policies targeting "Register security info" during Windows Hello for Business and macOS Platform SSO credential provisioning (not just sign-in). This update helps organizations prepare by identifying policies that may block legitimate device enrollment flows.

### Technical Details

- Added `checkCredentialRegistrationConstraints()` function to `src/lib/analyzer.ts`
- Updated `src/components/findings-list.tsx` with new category metadata
- Commit: `fc3c2b2` - feat: add May 2026 credential registration constraint check

---

## [1.2.0] - 2026-04-03

### Added

- **Privileged Role Exclusion Check** - Flags when high-privilege Entra ID roles (Global Admin, Privileged Role Admin, etc.) are excluded from CA policies
  - Detects 14 critical admin role exclusions
  - Provides attack scenarios based on policy context (security info registration, MFA bypass, block bypass)
  - Critical severity for Global Admin, Privileged Role Admin, Privileged Auth Admin, CA Admin exclusions
  - Tenant-wide check for policies excluding critical roles
  - Per-policy severity adjustments based on policy type and controls

- **Guest/External User Exclusion Check** - Flags when guest/external users are excluded from CA policies
  - Detects both simple ("GuestsOrExternalUsers") and structured guest exclusions
  - Parses 6 guest user types (b2bCollaborationGuest, b2bCollaborationMember, etc.)
  - Checks for compensating guest-specific policies
  - Adjusts severity based on presence of compensating policy
  - Tenant-wide gap analysis for guest coverage

- **New Finding Categories**
  - "Privileged Role Exclusion" with ShieldAlert icon (red)
  - "Guest/External User Exclusion" with AlertTriangle icon (orange)
  - "Guest/External User Coverage" with ShieldAlert icon (orange)

### Fixed

- Removed disabled-policy filtering from privileged role and guest exclusion checks
  - Rationale: Configuration issues like Global Admin exclusions are critical even on disabled policies (could be enabled without review)
  - Commit: `60d2052` - fix: flag privileged role and guest exclusions on disabled policies too

### Technical Details

- Added `checkPrivilegedRoleExclusions()` function with HIGH_PRIVILEGE_ROLE_IDS map
- Added `checkGuestExternalUserExclusions()` function with GUEST_TYPE_LABELS map
- Integrated checks into `analyzeAllPolicies()` call chain
- Updated findings-list.tsx with category metadata
- Commits: `4068d18`, `bac30ca`, `60d2052`

---

## [1.1.0] - 2026-02-26

### Added

- Device Registration Bypass check (pre-existing feature, discovered during deployment)
  - Flags when Device Registration Service (01cb2876-7ebd-4aa4-9cc9-d28bd4d359a9) is targeted with location or compliance conditions
  - Based on MSRC VULN-153600: DRS ignores location/compliance conditions by design, only honors MFA grant controls
  - Recommends creating dedicated MFA-only policy for DRS resource

### Changed

- Improved findings display in both Findings and Policies tabs
- Category grouping with icons for better visual organization
- Repeat findings gathered together for cleaner UI

---

## Earlier Versions

For changes prior to February 2026, see git history.

---

## Categories Reference

The analyzer uses the following finding categories:

- **Privileged Role Exclusion** - High-privilege roles excluded from policies
- **Guest/External User Exclusion** - Guest/external users excluded from policies
- **Guest/External User Coverage** - Tenant-wide guest coverage gaps
- **Credential Registration Constraints** - Constraints that may block WHfB/Platform SSO setup
- **Device Registration Bypass** - DRS targeted with location/compliance conditions
- **FOCI Token Sharing** - FOCI family exclusions enabling token sharing
- **Resource Exclusion Bypass** - Resource exclusions creating bypass paths
- **CA-Immune Resources** - Resources immune to CA by design
- **User-Agent Bypass** - Platform/client app conditions enabling UA spoofing
- **Swiss Cheese Model** - Policy scope or control gaps
- **App Exclusion** - High-risk app exclusions
- **Policy Scope** - Policy targeting issues
- **Policy State** - Report-only or disabled policies
- **Resilience** - Session control and resilience issues
- **Location Configuration** - Named location configuration issues
- **Legacy Authentication** - Legacy auth blocking gaps
- **MFA Coverage** - MFA enforcement gaps
- **Break-Glass** - Break-glass account issues
- **MS Learn: Documented Exclusion** - Exclusions documented in MS Learn
- **Microsoft-Managed Policies** - Microsoft-managed policy issues

---

[Unreleased]: https://github.com/Jhope188/ca-policy-analyzer/compare/v1.9.0...HEAD
[1.9.0]: https://github.com/Jhope188/ca-policy-analyzer/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/Jhope188/ca-policy-analyzer/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/Jhope188/ca-policy-analyzer/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/Jhope188/ca-policy-analyzer/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/Jhope188/ca-policy-analyzer/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Jhope188/ca-policy-analyzer/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Jhope188/ca-policy-analyzer/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Jhope188/ca-policy-analyzer/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Jhope188/ca-policy-analyzer/releases/tag/v1.1.0
