/**
 * GitHub Template Fetcher
 *
 * Fetches CA policy JSON files from a public GitHub repository and
 * converts them into PolicyTemplate objects with auto-generated fingerprints
 * for comparison against a tenant's existing policies.
 */

import {
  PolicyTemplate,
  TemplateFingerprint,
  TemplateCategory,
  TemplatePriority,
  DeploymentPolicy,
} from "@/data/policy-templates";

// ─── Types ───────────────────────────────────────────────────────────────────

interface GitHubFile {
  name: string;
  path: string;
  download_url: string;
  type: "file" | "dir";
}

export interface BaselineBundle {
  /** Policy-exclusion / break-glass / service-account groups (id → displayName). */
  groups: Record<string, string>;
  /** Named locations referenced by policies (id → displayName). */
  namedLocations: Record<string, string>;
  /** True if a MigrationTable.json was found at the bundle root. */
  hasMigrationTable: boolean;
}

export interface GitHubTemplateResult {
  templates: PolicyTemplate[];
  repoUrl: string;
  repoDisplay: string; // "owner/repo"
  /** Companion artifacts when the repo is a full restore bundle. */
  bundle?: BaselineBundle;
  error?: string;
}

// ─── Decoding ────────────────────────────────────────────────────────────────

/**
 * Decode a fetched response body, sniffing the BOM to pick the right charset.
 * PowerShell `ConvertTo-Json | Out-File` on Windows defaults to UTF-16 LE;
 * other tools emit UTF-8 with or without a BOM. Always prefer the BOM over
 * the HTTP content-type because raw.githubusercontent.com always advertises
 * text/plain regardless of the actual encoding.
 */
function decodeBody(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  // UTF-16 LE: FF FE
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  // UTF-16 BE: FE FF
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  // UTF-8 BOM: EF BB BF
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  return new TextDecoder("utf-8").decode(bytes);
}

// ─── Classification ──────────────────────────────────────────────────────────

type JsonKind =
  | "capolicy"
  | "group"
  | "namedlocation"
  | "migrationtable"
  | "unknown";

/**
 * Classify a parsed JSON payload so bundle exports (Groups, NamedLocations,
 * MigrationTable) don't get rejected as failed CA policies.
 */
function classifyJson(
  data: unknown,
  fileName: string,
  filePath: string
): JsonKind {
  if (!data || typeof data !== "object") return "unknown";
  const obj = data as Record<string, unknown>;

  // MigrationTable: { TenantId, Objects: [{ DisplayName, Id, Type }] }
  if (
    /migrationtable/i.test(fileName) ||
    (Array.isArray(obj.Objects) && typeof obj.TenantId === "string")
  ) {
    return "migrationtable";
  }

  const odataType = (obj["@odata.type"] as string | undefined) ?? "";
  const odataContext = (obj["@odata.context"] as string | undefined) ?? "";
  const lowerPath = filePath.toLowerCase();

  // Named locations: country / IP / compliant-network
  if (
    /\/namedlocations(\/|$)/i.test(lowerPath) ||
    /namedLocation/i.test(odataContext) ||
    odataType.includes("NamedLocation") ||
    Array.isArray(obj.countriesAndRegions) ||
    Array.isArray(obj.ipRanges)
  ) {
    return "namedlocation";
  }

  // Groups: have groupTypes / mailEnabled / securityEnabled or live in Groups/
  if (
    /\/groups(\/|$)/i.test(lowerPath) ||
    /\/groups\/\$entity/i.test(odataContext) ||
    Array.isArray(obj.groupTypes) ||
    typeof obj.mailEnabled === "boolean" ||
    typeof obj.securityEnabled === "boolean"
  ) {
    // But only if it's clearly NOT a CA policy
    if (!obj.conditions) return "group";
  }

  // CA policy: requires displayName + a conditions object
  if (
    typeof obj.displayName === "string" &&
    obj.conditions &&
    typeof obj.conditions === "object"
  ) {
    return "capolicy";
  }

  return "unknown";
}

// ─── Parse Repo URL ──────────────────────────────────────────────────────────

/**
 * Parse a GitHub URL into owner/repo and optional subpath.
 * Accepts:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/main/some/path
 *   owner/repo
 */
function parseGitHubUrl(input: string): {
  owner: string;
  repo: string;
  path: string;
  branch: string;
} | null {
  const trimmed = input.trim().replace(/\/+$/, "");

  // Try full URL: https://github.com/owner/repo[/tree/branch/path]
  const urlMatch = trimmed.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+))?)?$/
  );
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      path: urlMatch[4] ?? "",
      branch: urlMatch[3] ?? "main",
    };
  }

  // Try shorthand: owner/repo
  const shortMatch = trimmed.match(/^([^/]+)\/([^/]+)$/);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
      path: "",
      branch: "main",
    };
  }

  return null;
}

// ─── Fetch JSON Files ────────────────────────────────────────────────────────

async function fetchJsonFiles(
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<{ files: GitHubFile[]; error?: string }> {
  // First try the GitHub API to list directory contents
  const apiPath = path ? `contents/${path}` : "contents";
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/${apiPath}?ref=${branch}`;

  try {
    const resp = await fetch(apiUrl, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });

    if (resp.status === 403) {
      return {
        files: [],
        error:
          "GitHub API rate limit reached. Try again in a few minutes or use a shorter repo path.",
      };
    }
    if (resp.status === 404) {
      // If path was empty, try common subdirectories
      if (!path) {
        for (const subdir of ["Policies", "policies", "CA", "ca-policies"]) {
          const subResp = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${subdir}?ref=${branch}`,
            { headers: { Accept: "application/vnd.github.v3+json" } }
          );
          if (subResp.ok) {
            const items = (await subResp.json()) as GitHubFile[];
            const jsonFiles = items.filter(
              (f) => f.type === "file" && f.name.endsWith(".json")
            );
            if (jsonFiles.length > 0) return { files: jsonFiles };
          }
        }
      }
      return {
        files: [],
        error: `Repository or path not found: ${owner}/${repo}${path ? `/${path}` : ""}`,
      };
    }
    if (!resp.ok) {
      return {
        files: [],
        error: `GitHub API error: ${resp.status} ${resp.statusText}`,
      };
    }

    const items = (await resp.json()) as GitHubFile[];

    // If it's a single file, wrap it
    if (!Array.isArray(items)) {
      return { files: [] };
    }

    // Filter to JSON files only
    const jsonFiles = items.filter(
      (f) => f.type === "file" && f.name.endsWith(".json")
    );

    // Also recurse into subdirectories to find JSON files
    const dirs = items.filter((f) => f.type === "dir");
    for (const dir of dirs) {
      const subResult = await fetchJsonFiles(owner, repo, dir.path, branch);
      jsonFiles.push(...subResult.files);
    }

    return { files: jsonFiles };
  } catch (err) {
    return {
      files: [],
      error: `Failed to connect to GitHub: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

// ─── Convert Graph Policy to Template ────────────────────────────────────────

function inferCategory(displayName: string): TemplateCategory {
  const name = displayName.toLowerCase();
  if (name.includes("workload") || name.includes("service principal"))
    return "workload";
  if (name.includes("agent")) return "agent";
  if (name.includes("ztca") || name.includes("zero trust")) return "ztca";
  if (name.includes("intune") || name.includes("compliant")) return "intune";
  if (name.includes("app_") || name.includes("app -") || name.includes("app_-"))
    return "app-specific";
  if (
    name.includes("global") ||
    name.includes("foundation") ||
    name.includes("mfa") ||
    name.includes("block")
  )
    return "foundation";
  if (name.includes("p2") || name.includes("risk")) return "p2";
  return "baseline";
}

function inferPriority(policy: Record<string, unknown>): TemplatePriority {
  const conditions = policy.conditions as Record<string, unknown> | undefined;
  const users = conditions?.users as Record<string, unknown> | undefined;
  const apps = conditions?.applications as Record<string, unknown> | undefined;

  const includeUsers = (users?.includeUsers as string[]) ?? [];
  const includeApps = (apps?.includeApplications as string[]) ?? [];

  // All users + all apps = critical
  if (includeUsers.includes("All") && includeApps.includes("All"))
    return "critical";
  // All users or admin roles = recommended
  if (
    includeUsers.includes("All") ||
    ((users?.includeRoles as string[]) ?? []).length > 0
  )
    return "recommended";
  return "optional";
}

function buildFingerprint(
  policy: Record<string, unknown>
): TemplateFingerprint {
  const conditions = policy.conditions as Record<string, unknown> | undefined;
  const users = conditions?.users as Record<string, unknown> | undefined;
  const apps = conditions?.applications as Record<string, unknown> | undefined;
  const grant = policy.grantControls as Record<string, unknown> | undefined;
  const session = policy.sessionControls as Record<string, unknown> | undefined;

  const includeUsers = (users?.includeUsers as string[]) ?? [];
  const includeRoles = (users?.includeRoles as string[]) ?? [];
  const includeApps = (apps?.includeApplications as string[]) ?? [];
  const includeUserActions = (apps?.includeUserActions as string[]) ?? [];
  const grantControls = (grant?.builtInControls as string[]) ?? [];
  const grantOperator = (grant?.operator as "AND" | "OR") ?? "OR";

  const fp: TemplateFingerprint = {
    includeApps: includeApps.length > 0 ? includeApps : includeUserActions,
  };

  if (grantControls.length > 0) {
    fp.grantControls = grantControls;
    if (grantControls.length > 1) fp.grantOperator = grantOperator;
  }

  if (includeUsers.includes("All")) fp.targetsAllUsers = true;
  if (includeRoles.length > 0) fp.targetRoles = includeRoles;

  const signInRisk = (conditions?.signInRiskLevels as string[]) ?? [];
  const userRisk = (conditions?.userRiskLevels as string[]) ?? [];
  if (signInRisk.length > 0) fp.signInRiskLevels = signInRisk;
  if (userRisk.length > 0) fp.userRiskLevels = userRisk;

  const clientAppTypes = (conditions?.clientAppTypes as string[]) ?? [];
  if (
    clientAppTypes.length > 0 &&
    !(clientAppTypes.length === 1 && clientAppTypes[0] === "all")
  ) {
    fp.clientAppTypes = clientAppTypes;
  }

  // Platforms
  const platforms = conditions?.platforms as Record<string, unknown> | undefined;
  if (platforms) {
    const incPlat = (platforms.includePlatforms as string[]) ?? [];
    const excPlat = (platforms.excludePlatforms as string[]) ?? [];
    if (incPlat.length > 0 || excPlat.length > 0) {
      fp.platforms = { include: incPlat, exclude: excPlat };
    }
  }

  // Locations
  const locations = conditions?.locations as Record<string, unknown> | undefined;
  if (locations) {
    const incLoc = (locations.includeLocations as string[]) ?? [];
    if (incLoc.length > 0) fp.usesLocationCondition = true;
  }

  // Session controls
  if (session) {
    if (session.signInFrequency) fp.sessionSignInFrequency = true;
    if (session.persistentBrowser) fp.sessionPersistentBrowser = true;
    if (session.cloudAppSecurity) fp.sessionCloudAppSecurity = true;
  }

  // User actions
  if (includeUserActions.length > 0) {
    fp.includeUserActions = includeUserActions;
    fp.includeApps = includeUserActions; // matcher uses includeApps for user actions too
  }

  // Guests
  const guestConfig = users?.includeGuestsOrExternalUsers as Record<
    string,
    unknown
  > | null;
  if (guestConfig) fp.targetsGuests = true;

  // Auth flows
  const authFlows = conditions?.authenticationFlows as Record<
    string,
    unknown
  > | undefined;
  if (authFlows) {
    const transferMethods = (authFlows.transferMethods as string[]) ?? [];
    if (transferMethods.length > 0)
      fp.authenticationFlows = transferMethods;
  }

  return fp;
}

function policyToTemplate(
  policy: Record<string, unknown>,
  index: number
): PolicyTemplate | null {
  const displayName = (policy.displayName as string) ?? `Policy ${index + 1}`;

  // Build a clean deployment JSON (strip @odata, id, etc.)
  const deployment: DeploymentPolicy = {
    displayName,
    state: "disabled",
    conditions: (policy.conditions as DeploymentPolicy["conditions"]) ?? {
      users: {
        includeUsers: [],
        excludeUsers: [],
        includeGroups: [],
        excludeGroups: [],
        includeRoles: [],
        excludeRoles: [],
      },
      applications: {
        includeApplications: [],
        excludeApplications: [],
        includeUserActions: [],
      },
    },
    grantControls: (policy.grantControls as DeploymentPolicy["grantControls"]) ??
      undefined,
    sessionControls:
      (policy.sessionControls as DeploymentPolicy["sessionControls"]) ?? undefined,
  };

  const grant = policy.grantControls as Record<string, unknown> | undefined;
  const grantControls = (grant?.builtInControls as string[]) ?? [];
  const blocks = grantControls.includes("block");

  let controlType: "BLOCK" | "GRANT" | "SESSION" = "GRANT";
  if (blocks) controlType = "BLOCK";
  else if (
    !grant &&
    policy.sessionControls &&
    Object.keys(policy.sessionControls as object).length > 0
  )
    controlType = "SESSION";

  return {
    id: `custom-${index}-${displayName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`,
    displayName,
    category: "baseline",  // custom repo templates all go under one group
    controlType,
    priority: inferPriority(policy),
    summary: `Custom template: ${displayName}`,
    rationale: `Imported from GitHub repository. This policy ${blocks ? "blocks" : "controls"} access based on the configured conditions.`,
    fingerprint: buildFingerprint(policy),
    deploymentJson: deployment,
  };
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function fetchGitHubTemplates(
  input: string
): Promise<GitHubTemplateResult> {
  const parsed = parseGitHubUrl(input);
  if (!parsed) {
    return {
      templates: [],
      repoUrl: input,
      repoDisplay: input,
      error:
        "Invalid GitHub URL. Use: https://github.com/owner/repo or owner/repo",
    };
  }

  const { owner, repo, path, branch } = parsed;
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const repoDisplay = `${owner}/${repo}`;

  const { files, error } = await fetchJsonFiles(owner, repo, path, branch);
  if (error) {
    return { templates: [], repoUrl, repoDisplay, error };
  }

  if (files.length === 0) {
    return {
      templates: [],
      repoUrl,
      repoDisplay,
      error: `No JSON files found in ${repoDisplay}${path ? `/${path}` : ""}. Make sure the repo contains CA policy JSON exports.`,
    };
  }

  // Fetch and parse each JSON file (in parallel, batched). Files may be CA
  // policies, Group exports, NamedLocation exports, or a MigrationTable —
  // classify each one and route to the appropriate bucket.
  const templates: PolicyTemplate[] = [];
  const errors: string[] = [];
  const bundle: BaselineBundle = {
    groups: {},
    namedLocations: {},
    hasMigrationTable: false,
  };

  const BATCH_SIZE = 10;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        const resp = await fetch(file.download_url);
        if (!resp.ok)
          throw new Error(`Failed to fetch ${file.name}: ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const text = decodeBody(buf);
        return {
          name: file.name,
          path: file.path,
          data: JSON.parse(text) as unknown,
        };
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { name, path: filePath, data } = result.value;
        const kind = classifyJson(data, name, filePath);
        if (kind === "capolicy") {
          const template = policyToTemplate(
            data as Record<string, unknown>,
            templates.length
          );
          if (template) templates.push(template);
        } else if (kind === "group") {
          const g = data as Record<string, unknown>;
          const id = (g.id as string) ?? "";
          const dn = (g.displayName as string) ?? name.replace(/\.json$/i, "");
          if (id) bundle.groups[id] = dn;
        } else if (kind === "namedlocation") {
          const nl = data as Record<string, unknown>;
          const id = (nl.id as string) ?? "";
          const dn = (nl.displayName as string) ?? name.replace(/\.json$/i, "");
          if (id) bundle.namedLocations[id] = dn;
        } else if (kind === "migrationtable") {
          bundle.hasMigrationTable = true;
          // MigrationTable can also seed Group displayName lookups by Id.
          const mt = data as Record<string, unknown>;
          const objs = (mt.Objects as Array<Record<string, unknown>>) ?? [];
          for (const o of objs) {
            const id = (o.Id as string) ?? "";
            const dn = (o.DisplayName as string) ?? "";
            const type = (o.Type as string) ?? "";
            if (id && dn && type === "Group" && !bundle.groups[id]) {
              bundle.groups[id] = dn;
            }
          }
        }
        // unknown → silently skipped (don't pollute the error list)
      } else {
        errors.push(result.reason?.message ?? "Unknown fetch error");
      }
    }
  }

  if (templates.length === 0) {
    return {
      templates: [],
      repoUrl,
      repoDisplay,
      error: `Found ${files.length} JSON files but none were valid CA policy exports. Files should contain Graph API Conditional Access policy JSON.`,
    };
  }

  const groupCount = Object.keys(bundle.groups).length;
  const nlCount = Object.keys(bundle.namedLocations).length;
  const hasBundle = groupCount > 0 || nlCount > 0 || bundle.hasMigrationTable;

  // Build a friendly status string. When companion artifacts are present we
  // surface them so the user knows the full restore bundle was understood.
  let info: string | undefined;
  if (hasBundle) {
    const parts: string[] = [`${templates.length} policies`];
    if (groupCount > 0) parts.push(`${groupCount} groups`);
    if (nlCount > 0) parts.push(`${nlCount} named locations`);
    if (bundle.hasMigrationTable) parts.push("migration table");
    info = `Loaded ${parts.join(" + ")}.`;
  }
  if (errors.length > 0) {
    const skipped = `${errors.length} file${errors.length === 1 ? "" : "s"} skipped`;
    info = info ? `${info} (${skipped})` : `Loaded ${templates.length} templates (${skipped})`;
  }

  return {
    templates,
    repoUrl,
    repoDisplay,
    bundle: hasBundle ? bundle : undefined,
    error: info,
  };
}
