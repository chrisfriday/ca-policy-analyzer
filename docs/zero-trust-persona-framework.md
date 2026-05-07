# Zero Trust + Persona Framework for Conditional Access

> Reference doc consolidating the persona-based Conditional Access design model used by CA Policy Analyzer. Based on Claus Jespersen's Microsoft Zero Trust framework, Welkasworld design articles, and community baselines from Kenneth van Surksum and Joey Verlinden.

---

## Why a persona framework?

Conditional Access policies don't scale by themselves. As soon as a tenant has more than ~10 policies the question is no longer *"do we have an MFA policy?"* — it's *"which users, in which personas, under which conditions, are protected by which controls?"*

A **persona-based** framework answers that question by:

1. Segmenting identities into a small, named set of personas (Admins, Internals, Externals, Workload Identities, etc.)
2. Defining the **expected control bundle** for each persona (block legacy auth, MFA, compliant device, sign-in/user risk, session controls, country block)
3. Naming policies so the persona is encoded in the `displayName` (e.g. `CA101-Admins-Identity-MFA-AnyApp`)
4. Reviewing coverage as a **persona × control matrix** rather than a flat list

The result: gaps and overlaps become visible at a glance, and onboarding new admins is an exercise in reading naming conventions rather than reverse-engineering 80+ policies.

---

## Personas

CA Policy Analyzer recognises the following personas (see [`src/lib/personas.ts`](../src/lib/personas.ts)):

| Persona | Naming tokens detected | Purpose | Key expected controls |
|---|---|---|---|
| 🌐 **Global** | `Global`, `AllUser`, `TenantWide`, `Baseline`, `AllApps` | Tenant-wide baselines | Block legacy auth, country block |
| 🛡️ **Admins** | `Admin`, `PrivilegedUser`, `PrivRole` | Privileged role holders | Phishing-resistant MFA, compliant device, SIF, sign-in risk, user risk |
| 👤 **Internals** | `Internal`, `Employee`, `Member`, `Staff` | Standard employees | MFA, compliant device, sign-in/user risk |
| 🤝 **Externals** | `External`, `Guest`, `B2B` | B2B collaboration guests/members | MFA (auth strength when home tenant trusts) |
| 🛡️🤝 **GuestAdmins** | `GuestAdmin`, `ExternalAdmin`, `GDAP`, `CSP` | External privileged users | Phishing-resistant MFA, SIF |
| 💻 **Developers** | `Developer`, `Dev`, `Engineer` | Developer scenarios | MFA, compliant device, user risk |
| ⚙️ **CorpServiceAccounts** | `CorpServiceAccount`, `CorpSvc`, `SvcAccount` | User-mode service accounts | Locked to corp networks/locations |
| 🤖 **WorkloadIdentities** | `WorkloadIdentity`, `ServicePrincipal`, `ManagedIdentity` | Service principals & MIs (Workload ID Premium) | Network/location restriction, sign-in risk |
| 🔧 **Microsoft365ServiceAccounts** | `M365Service`, `M365Svc`, `EntraConnect`, `AADConnect` | Sync accounts | Excluded from MFA, locked to known locations |

Detection is case-insensitive, applied to the policy `displayName` as a whole word, and uses a most-specific-first match order so `GuestAdmin` doesn't accidentally hit the `Externals` bucket.

---

## Naming conventions

The community has converged on a numbered, prefixed naming scheme:

```
CA<NNN>-<Persona>-<PolicyType>-<Target>-<Control>
```

Examples:
- `CA001-Global-BaseProtection-AllApps-BlockLegacyAuth`
- `CA101-Admins-Identity-AllApps-RequireMFAAndCompliantDevice`
- `CA201-Internals-Attack-AllApps-BlockHighRisk`
- `CA301-Externals-Identity-AllApps-RequireMFA`
- `CA601-CorpServiceAccounts-Network-AllApps-BlockNonCorpNetwork`
- `CA701-WorkloadIdentities-Network-AllApps-BlockNonCorpNetwork`

**Why numbered ranges?**

| Range | Persona | Why this range |
|---|---|---|
| `CA001-099` | Global | Applies first conceptually — tenant baseline |
| `CA100-199` | Admins | Highest-privilege user persona, evaluated next |
| `CA200-299` | Internals | Bulk of the user base |
| `CA300-399` | Externals | B2B path |
| `CA400-499` | GuestAdmins | External privileged |
| `CA500-599` | Developers | |
| `CA600-699` | CorpServiceAccounts | |
| `CA700-799` | WorkloadIdentities | |
| `CA800-899` | Microsoft365ServiceAccounts | |

Numbered ranges mean the policy list sorts naturally by persona and you can reserve gaps for future policies without renumbering.

---

## Expected control bundle per persona

Each persona has a recommended **minimum control set**. CA Policy Analyzer uses these to compute persona coverage scoring (Phase 2 — see the implementation roadmap below).

| Control | Global | Admins | Internals | Externals | GuestAdmins | Developers | CorpSvc | Workload | M365Svc |
|---|---|---|---|---|---|---|---|---|---|
| Block legacy auth | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Require MFA | — | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | — | ❌ |
| Phishing-resistant MFA | — | ✅ | optional | optional | ✅ | optional | — | — | — |
| Require compliant/hybrid device | — | ✅ | ✅ | optional | optional | ✅ | — | — | — |
| Sign-in risk | — | ✅ | ✅ | optional | optional | optional | — | ✅ | — |
| User risk | — | ✅ | ✅ | optional | optional | ✅ | — | — | — |
| Session SIF | — | ✅ | optional | optional | ✅ | optional | — | — | — |
| Block countries | ✅ | optional | optional | optional | optional | optional | optional | optional | optional |
| Lock to corp network | — | — | — | — | — | — | ✅ | ✅ | ✅ |

Legend: ✅ required · optional · ❌ explicitly excluded · — not applicable

---

## Community baselines (one-click load)

CA Policy Analyzer's Templates tab includes one-click buttons for these public baselines:

### Kenneth van Surksum — `cabaseline202510`
- **Repo:** [kennethvs/cabaseline202510](https://github.com/kennethvs/cabaseline202510)
- Quarterly-refreshed Zero Trust persona baseline. Strong reference for production-grade tenants.

### Joey Verlinden — `ConditionalAccessBaseline`
- **Repo:** [j0eyv/ConditionalAccessBaseline](https://github.com/j0eyv/ConditionalAccessBaseline)
- Persona-based baseline aligned with Microsoft Zero Trust guidance and Claus Jespersen's framework.

### Claus Jespersen — `ConditionalAccessforZeroTrustResources` (canonical reference)
- **Repo:** [microsoft/ConditionalAccessforZeroTrustResources](https://github.com/microsoft/ConditionalAccessforZeroTrustResources)
- Original Microsoft persona framework reference. Includes presentations and design guidance:
  - [TroubleShooting CA Zero Trust (March 2022)](https://github.com/microsoft/ConditionalAccessforZeroTrustResources/blob/main/Presentations/Microsoft365SCUserGroup%20-%20TroubleShooting%20CA%20Zero%20Trust%20March%202022.pdf)
  - [Optimizing external access controls for B2B collaboration](https://github.com/microsoft/ConditionalAccessforZeroTrustResources/blob/main/Presentations/CA%20for%20Zero%20Trust%20-%20Optimizing%20external%20access%20controls%20for%20B2B%20collaboration.pdf)

When you load any of these, CA Policy Analyzer auto-detects the persona naming convention and groups the comparison by persona (Admins, Internals, Externals, etc.) instead of by prefix.

---

## Implementation roadmap

### Phase 1 — Persona detection & one-click baselines ✅
- Persona taxonomy + detection from `displayName` ([`src/lib/personas.ts`](../src/lib/personas.ts))
- One-click buttons for Kenneth, Joey, and Claus baselines in Templates view
- Persona-based grouping for custom repo templates (when persona signal is detected)

### Phase 2 — Persona coverage analyzer (planned)
- New tenant-wide finding: persona × required-control matrix
- Detect missing control coverage per persona
- Detect persona conflicts (admins targeted by Internals policies, etc.)

### Phase 3 — Zero Trust scorecard (planned)
- Dashboard panel scoring against ZT pillars:
  - **Verify explicitly** — MFA / auth strength on all personas
  - **Use least privilege** — PIM, role-scoped policies, no `All users + All apps` allow
  - **Assume breach** — sign-in/user risk, session controls, compliant device, location restrictions

### Phase 4 — Gap analysis vs known baselines (planned)
- Compare loaded tenant against a chosen baseline (Kenneth/Joey/Claus)
- Policy-by-policy gap report: missing personas, missing controls within a persona, deviations in grant/session controls

---

## References

### Welkasworld design articles
- [Naming conventions, personas, and design process](https://www.welkasworld.com/post/conditional-access-naming-conventions-personas-design-process)
- [Custom security attributes in Entra ID and cross-tenant scenarios](https://www.welkasworld.com/post/conditional-access-essentials-custom-security-attributes-in-entra-id-and-cross-tenant-scenarios)
- [Introduction, use cases, and the art of possible](https://www.welkasworld.com/post/conditional-access-essentials-introduction-use-cases-the-art-of-possible)

### Claus Jespersen (Microsoft) — original framework
- [microsoft/ConditionalAccessforZeroTrustResources](https://github.com/microsoft/ConditionalAccessforZeroTrustResources)
- [clajes/ConditionalAccessforZeroTrustResources](https://github.com/clajes/ConditionalAccessforZeroTrustResources)
- [Plan a Conditional Access deployment (Microsoft Learn)](https://learn.microsoft.com/en-us/entra/identity/conditional-access/plan-conditional-access)
- [Conditional Access Guidance — December 2021 (LinkedIn)](https://www.linkedin.com/posts/claus-jespersen-25b0422_conditional-access-guidance-december-2021-activity-6872879151271993344-u7Vd/)

### Community baselines
- [kennethvs/cabaseline202510](https://github.com/kennethvs/cabaseline202510)
- [j0eyv/ConditionalAccessBaseline](https://github.com/j0eyv/ConditionalAccessBaseline)
