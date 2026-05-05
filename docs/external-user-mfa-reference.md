# External User MFA — Where & How It's Satisfied

> Source: Microsoft Learn — Authentication and Conditional Access for External ID (verified May 2026)

---

## How to read this document

| Badge | Meaning |
|---|---|
| **Resource tenant** | MFA is always completed against your (resource) tenant |
| **Home tenant** | MFA is completed in the user's own (home) tenant |
| **Either (trust-dependent)** | Resource tenant by default; home tenant if inbound cross-tenant MFA trust is configured |
| **Blocked if no trust** | User is blocked entirely without inbound trust configuration — cannot be prompted for MFA |
| **Trust setting required** | Inbound cross-tenant access trust setting must be explicitly enabled |

Configure trust settings under: **Entra ID → External Identities → Cross-tenant access settings → Inbound trust**

---

## Quick reference matrix

| CA External User Type | Identity Provider | MFA Enforced By | Auth Strength Support | Cross-Tenant Trust Required |
|---|---|---|---|---|
| **Local / Internal Guest** (`internalGuest`) | Your own tenant | Resource tenant — always | ✅ Full method set | No |
| **B2B Collab Guest** (`b2bCollaborationGuest`) — Entra-backed | External Entra tenant | Either (trust-dependent) | ✅ Supported | Optional (enables home tenant path) |
| **B2B Collab Guest** (`b2bCollaborationGuest`) — non-Entra | Google / OTP / SAML / WS-Fed | Resource tenant — always | ❌ NOT supported (use basic `mfa`) | N/A |
| **B2B Collab Member** (`b2bCollaborationMember`) | External Entra tenant | Either (trust-dependent) | ✅ Supported | Optional (enables home tenant path) |
| **B2B Direct Connect** (`b2bDirectConnectUser`) | External Entra tenant | Home tenant — mandatory | ✅ Supported (home methods only) | **REQUIRED** (else blocked) |
| **Service Provider** (`serviceProvider`) — GDAP/CSP | Partner Entra tenant | Home tenant — always | Partial (home methods only) | Auto-trusted by Microsoft |
| **Other External** (`otherExternalUser`) | Non-Entra | Resource tenant — always | ❌ NOT supported (use basic `mfa`) | N/A |

> ⚠️ **Heterogeneity warning:** `b2bCollaborationGuest` contains BOTH Entra-backed and non-Entra guests. CA cannot filter within this type by IdP. If your guest population is mixed, use the basic `mfa` grant control — authentication strength will block non-Entra guests instead of prompting them.

---

## Entra ID–backed external users

### B2B Collaboration Guest (`b2bCollaborationGuest`)

- **UserType:** Guest
- **Who:** Invited or self-service sign-up via an external Entra ID tenant
- **MFA enforced by:** Either (resource tenant by default; home tenant if inbound MFA trust configured)

| Where MFA completes | Supported methods |
|---|---|
| **Resource tenant** | Authenticator push, OATH software token, SMS, Voice |
| **Home tenant** (trust required) | Authenticator push, Authenticator phone sign-in, OATH software, OATH hardware, FIDO2, Windows Hello for Business, Certificate-based auth (CBA), SMS, Voice |

**Authentication strength support:** ✅ Supported — but only when the user authenticated via Entra ID.

> ⚠️ **Important:** `b2bCollaborationGuest` is a heterogeneous CA type. It can contain both Entra-backed guests (auth strength works) and non-Entra guests (Google federation, email OTP, SAML/WS-Fed — auth strength blocks them). CA cannot filter within this type by IdP. Use the basic MFA grant control if your guest population is mixed.

---

### B2B Collaboration Member (`b2bCollaborationMember`)

- **UserType:** Member
- **Who:** External Entra user with member-level access (common in multi-tenant organisations)
- **MFA enforced by:** Either (same behaviour as B2B collab guest)

| Where MFA completes | Supported methods |
|---|---|
| **Resource tenant** | Authenticator push, OATH software token, SMS, Voice |
| **Home tenant** (trust required) | Authenticator push, Authenticator phone sign-in, OATH software, OATH hardware, FIDO2, Windows Hello for Business, CBA, SMS, Voice |

**Authentication strength support:** ✅ Supported

---

### B2B Direct Connect (`b2bDirectConnectUser`)

- **UserType:** No user object in resource directory
- **Who:** External Entra users accessing Teams Connect shared channels (only current scenario)
- **MFA enforced by:** Home tenant — **MANDATORY**. If inbound trust is not configured, the user is **blocked entirely**. Cannot complete MFA in the resource tenant.

| Where MFA completes | Supported methods |
|---|---|
| **Resource tenant** | ❌ Not possible — no presence in resource directory |
| **Home tenant** (trust REQUIRED) | Authenticator push, Authenticator phone sign-in, OATH software, OATH hardware, FIDO2, Windows Hello for Business, CBA, SMS, Voice |

**Authentication strength support:** ✅ Supported — home tenant methods only. Ensure your authentication strength allowed combinations include methods the partner tenant has enabled.

> ⚠️ Inbound MFA trust settings are **mandatory** for B2B direct connect to work at all when CA requires MFA. Without trust configured, access is blocked.

---

### Service Provider / GDAP (`serviceProvider`)

- **UserType:** External admin (isServiceProvider = true)
- **Who:** Cloud service provider or CSP/GDAP partner technicians administering your tenant
- **MFA enforced by:** Home tenant — **always**. This behaviour is hardcoded by Microsoft and cannot be changed.

| Where MFA completes | Supported methods |
|---|---|
| **Resource tenant** | ❌ Not applicable — resource tenant MFA registration is not supported for GDAP users |
| **Home tenant** (always trusted automatically) | Any method the partner (home) tenant supports |

**Authentication strength support:** Technically applicable, but only home tenant methods are usable. Verify partner tenant MFA methods align with your allowed combinations.

> ℹ️ Per Microsoft Learn: when an external user signs in using GDAP, MFA is always required in the user's home tenant and always trusted in the resource tenant — regardless of your trust settings configuration.

---

## Non–Entra ID external users

### B2B Collaboration Guest (non-Entra IdP)

- **Who:** Users who redeemed a B2B invitation via Google, Facebook, SAML/WS-Fed federation, or email one-time passcode (OTP). Still appears as `b2bCollaborationGuest` in CA policy assignments.
- **MFA enforced by:** Resource tenant — **always**. No cross-tenant trust is available for non-Entra identity providers.

| Where MFA completes | Supported methods |
|---|---|
| **Resource tenant** | Authenticator push, OATH software token, SMS, Voice (user registers with resource tenant) |
| **Home tenant** | ❌ Not applicable — no Entra home tenant |

**Authentication strength support:** ❌ NOT supported. Must use the basic `mfa` built-in grant control. Applying an authentication strength policy to these users will **block them** instead of prompting for MFA.

---

### Other External User (`otherExternalUser`)

- **Who:** Any external user who doesn't fit the above categories, is not an internal Entra member, and does not authenticate internally via Entra ID
- **MFA enforced by:** Resource tenant — **always**

| Where MFA completes | Supported methods |
|---|---|
| **Resource tenant** | Authenticator push, OATH software token, SMS, Voice |
| **Home tenant** | ❌ Not applicable |

**Authentication strength support:** ❌ NOT supported. Must use the basic `mfa` grant control.

---

## Internal directory users with guest status

### Local / Internal Guest (`internalGuest`)

- **UserType:** Guest, but credentials are managed in your own directory
- **Who:** Legacy pattern pre-B2B. Account exists only in your tenant.
- **MFA enforced by:** Resource tenant — **always** (there is no home tenant)

| Where MFA completes | Supported methods |
|---|---|
| **Resource tenant** | All methods your tenant supports |
| **Home tenant** | ❌ Not applicable — no external home tenant |

**Authentication strength support:** ✅ Fully supported. Full method set available since the account is local.

---

## Authentication strength — accepted methods by location

Per Microsoft Learn Table 1 (Authentication strength MFA methods for external users):

| Authentication method | Home tenant (trusted) | Resource tenant |
|---|---|---|
| SMS as second factor | ✅ | ✅ |
| Voice call | ✅ | ✅ |
| Microsoft Authenticator push notification | ✅ | ✅ |
| Microsoft Authenticator phone sign-in | ✅ | ❌ |
| OATH software token | ✅ | ✅ |
| OATH hardware token | ✅ | ❌ |
| FIDO2 security key | ✅ | ❌ |
| Windows Hello for Business | ✅ | ❌ |
| Certificate-based authentication (CBA) | ✅ | ❌ |

> Methods like FIDO2, WHfB, OATH hardware, and CBA are **only usable from the home tenant**. If you require phishing-resistant methods, you must configure inbound MFA trust so the home tenant path is used.

---

## Policy design implications

| Scenario | Recommended CA grant control |
|---|---|
| Entra-backed B2B guests with inbound trust configured | Authentication strength (e.g. Inforcer - Authentication) |
| Mixed guest population (Entra + non-Entra) | Basic `mfa` grant — auth strength blocks non-Entra guests |
| B2B direct connect users | Authentication strength — but inbound trust is mandatory first |
| Email OTP / Google / SAML guests (`otherExternalUser`) | Basic `mfa` grant only |
| GDAP/CSP service providers | Basic `mfa` grant or auth strength — home tenant always satisfies |
| Local/internal guests | Authentication strength — full local method set available |

---

## References

- [Authentication and Conditional Access for External ID](https://learn.microsoft.com/entra/external-id/authentication-conditional-access)
- [Require authentication strength for external users](https://learn.microsoft.com/entra/identity/conditional-access/policy-guests-mfa-strength)
- [Manage cross-tenant access settings for B2B collaboration](https://learn.microsoft.com/entra/external-id/cross-tenant-access-settings-b2b-collaboration)
- [B2B direct connect overview](https://learn.microsoft.com/entra/external-id/b2b-direct-connect-overview)
- [Microsoft Entra B2B best practices](https://learn.microsoft.com/entra/external-id/b2b-fundamentals)
