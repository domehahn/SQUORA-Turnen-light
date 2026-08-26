#!/usr/bin/env -S npx tsx
/**
 * Privacy/Security production-readiness check for the Turnen (SQUORA) app.
 *
 * Runs automated checks that CAN be verified from this repository and the
 * Wrangler CLI. It does NOT and cannot verify Cloudflare dashboard-only
 * configuration (Cache Rules, WAF, Logpush, Access) — those are marked
 * "VERIFY IN CLOUDFLARE DASHBOARD" in docs/privacy/cloudflare-data-flow.md
 * and docs/security/cloudflare-security.md instead.
 *
 * This script does NOT modify any Cloudflare resource. It only reads
 * configuration and reports findings. Blocking findings exit with code 1.
 *
 * Usage (from turnen/worker, where wrangler is configured):
 *   npx tsx ../../scripts/privacy-check.ts
 *
 * See docs/security/cloudflare-production-checklist.md for the full list
 * of checks this script does and does not cover.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

interface CheckResult {
  id: string;
  description: string;
  status: "pass" | "fail" | "warn" | "skip";
  detail: string;
  blocking: boolean;
}

const results: CheckResult[] = [];

function record(result: CheckResult): void {
  results.push(result);
}

// Repo root = parent of this script's directory (scripts/../)
const REPO_ROOT = path.resolve(__dirname, "..");
const WORKER_DIR = path.join(REPO_ROOT, "turnen", "worker");
const FRONTEND_DIST = path.join(REPO_ROOT, "turnen", "dist");
const WORKER_WRANGLER_TOML = path.join(WORKER_DIR, "wrangler.toml");
const WEB_WRANGLER_TOML = path.join(REPO_ROOT, "turnen", "wrangler.toml");

// --- Check 1: D1 jurisdiction --------------------------------------------
//
// A location hint (e.g. "weur") is NOT an EU jurisdiction restriction.
// This is the check the user's spec explicitly asks for
// (D1_DATABASE_WITHOUT_EU_JURISDICTION). We shell out to `wrangler d1 info`
// because jurisdiction is a property of the D1 resource itself, not
// something expressed in wrangler.toml.
function checkD1Jurisdiction(): void {
  if (!existsSync(WORKER_WRANGLER_TOML)) {
    record({
      id: "d1-jurisdiction",
      description: "Production D1 database uses jurisdiction=eu",
      status: "skip",
      detail: `No worker/wrangler.toml found at ${WORKER_WRANGLER_TOML}`,
      blocking: false,
    });
    return;
  }
  const tomlContent = readFileSync(WORKER_WRANGLER_TOML, "utf8");
  const dbNameMatch = tomlContent.match(/database_name\s*=\s*"([^"]+)"/);
  if (!dbNameMatch) {
    record({
      id: "d1-jurisdiction",
      description: "Production D1 database uses jurisdiction=eu",
      status: "skip",
      detail: "No [[d1_databases]] binding found in wrangler.toml — no D1 database in this project.",
      blocking: false,
    });
    return;
  }
  const dbName = dbNameMatch[1];
  try {
    const output = execSync(`npx wrangler d1 info ${dbName}`, { cwd: WORKER_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const jurisdictionMatch = output.match(/jurisdiction\s*│\s*([a-z-]+)/i);
    const regionMatch = output.match(/running_in_region\s*│\s*([A-Z]+)/i);
    const jurisdiction = jurisdictionMatch?.[1]?.trim() ?? "null";
    const region = regionMatch?.[1]?.trim() ?? "unknown";
    if (jurisdiction.toLowerCase() === "eu") {
      record({
        id: "d1-jurisdiction",
        description: "Production D1 database uses jurisdiction=eu",
        status: "pass",
        detail: `D1 "${dbName}" has jurisdiction=eu.`,
        blocking: true,
      });
    } else {
      record({
        id: "d1-jurisdiction",
        description: "Production D1 database uses jurisdiction=eu",
        status: "fail",
        detail:
          `HIGH PRIVACY FINDING: D1_DATABASE_WITHOUT_EU_JURISDICTION — ` +
          `D1 "${dbName}" has jurisdiction=${jurisdiction || "null"}, only running_in_region=${region} ` +
          `(a location hint, not a jurisdiction restriction). ` +
          `See docs/privacy/cloudflare-data-flow.md (finding CF-01) for the safe migration plan. ` +
          `Do NOT auto-migrate or delete data based on this script.`,
        blocking: true,
      });
    }
  } catch (err) {
    record({
      id: "d1-jurisdiction",
      description: "Production D1 database uses jurisdiction=eu",
      status: "warn",
      detail: `Could not run "wrangler d1 info ${dbName}" (not logged in / no network / wrangler not installed?): ${(err as Error).message}`,
      blocking: false,
    });
  }
}

// --- Check 2/3: R2 buckets (jurisdiction + public access) ---------------
function checkR2Buckets(): void {
  const tomlFiles = [WORKER_WRANGLER_TOML, WEB_WRANGLER_TOML].filter(existsSync);
  let anyBucket = false;
  for (const file of tomlFiles) {
    const content = readFileSync(file, "utf8");
    if (content.includes("[[r2_buckets]]")) {
      anyBucket = true;
      record({
        id: "r2-jurisdiction",
        description: "R2 buckets with personal/health data use jurisdiction=eu and are not public",
        status: "warn",
        detail: `Found [[r2_buckets]] in ${file} — this script cannot verify bucket jurisdiction/public-access status automatically (not exposed via a simple wrangler CLI read in this Wrangler version). VERIFY IN CLOUDFLARE DASHBOARD: jurisdiction=eu and no public access for any bucket storing personal or health data.`,
        blocking: false,
      });
    }
  }
  if (!anyBucket) {
    record({
      id: "r2-jurisdiction",
      description: "R2 buckets with personal/health data use jurisdiction=eu and are not public",
      status: "pass",
      detail: "No R2 buckets configured in this project.",
      blocking: false,
    });
  }
}

// --- Check 4: KV namespaces do not hold sensitive data (static check) ---
function checkKvNamespaces(): void {
  const tomlFiles = [WORKER_WRANGLER_TOML, WEB_WRANGLER_TOML].filter(existsSync);
  let anyKv = false;
  for (const file of tomlFiles) {
    if (readFileSync(file, "utf8").includes("[[kv_namespaces]]")) anyKv = true;
  }
  record({
    id: "kv-sensitive-data",
    description: "KV namespaces do not store child/health/consent data",
    status: anyKv ? "warn" : "pass",
    detail: anyKv
      ? "KV namespace(s) found — manually verify no personal/health data is stored as values (this script cannot inspect stored values)."
      : "No KV namespaces configured in this project.",
    blocking: false,
  });
}

// --- Check 5: secrets in frontend build -----------------------------------
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "JWT secret-looking assignment", pattern: /jwt[_-]?secret\s*[:=]\s*["'][^"']{10,}["']/i },
  { name: "Generic API key assignment", pattern: /api[_-]?key\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i },
  { name: "AWS-style access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "Private key block", pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
];

function walkFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkFiles(full, out);
    else if (/\.(js|css|html|map)$/.test(entry)) out.push(full);
  }
}

function checkFrontendSecrets(): void {
  if (!existsSync(FRONTEND_DIST)) {
    record({
      id: "frontend-secrets",
      description: "No secrets in frontend build output",
      status: "skip",
      detail: `${FRONTEND_DIST} does not exist — run "npm run build" in turnen/ first if you want this check to run.`,
      blocking: false,
    });
    return;
  }
  const files: string[] = [];
  walkFiles(FRONTEND_DIST, files);
  const findings: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(content)) findings.push(`${name} in ${path.relative(REPO_ROOT, file)}`);
    }
  }
  record({
    id: "frontend-secrets",
    description: "No secrets in frontend build output",
    status: findings.length > 0 ? "fail" : "pass",
    detail: findings.length > 0 ? findings.join("; ") : `Scanned ${files.length} build files, no known secret patterns found.`,
    blocking: findings.length > 0,
  });
}

// --- Check 6: health endpoints are not cacheable (static source check) --
function checkNoStoreOnApi(): void {
  const indexTs = path.join(WORKER_DIR, "src", "index.ts");
  if (!existsSync(indexTs)) {
    record({
      id: "api-no-store",
      description: "/api/* responses set Cache-Control: no-store",
      status: "skip",
      detail: `${indexTs} not found.`,
      blocking: false,
    });
    return;
  }
  const content = readFileSync(indexTs, "utf8");
  const hasNoStore = /"\/api\/\*"[\s\S]{0,300}Cache-Control[\s\S]{0,50}no-store/.test(content);
  record({
    id: "api-no-store",
    description: "/api/* responses set Cache-Control: no-store",
    status: hasNoStore ? "pass" : "fail",
    detail: hasNoStore
      ? "Global middleware on /api/* sets Cache-Control: no-store (worker/src/index.ts)."
      : "No Cache-Control: no-store middleware found on /api/* in worker/src/index.ts — health data responses may be cacheable.",
    blocking: !hasNoStore,
  });
  record({
    id: "api-no-store-dashboard",
    description: "Dashboard Cache Rules do not override the no-store header",
    status: "warn",
    detail: "VERIFY IN CLOUDFLARE DASHBOARD: this script cannot check zone-level Cache Rules that could override origin Cache-Control headers.",
    blocking: false,
  });
}

// --- Check 7/8: debug logging / auth bypass (static source check) -------
function checkAuthBypassAndDebug(): void {
  const indexTs = path.join(WORKER_DIR, "src", "index.ts");
  if (!existsSync(indexTs)) return;
  const content = readFileSync(indexTs, "utf8");
  const bypassPattern = /(NODE_ENV\s*===?\s*["']development["']|DEBUG\s*=\s*true|skipAuth|bypassAuth)/i;
  const hasBypass = bypassPattern.test(content);
  record({
    id: "auth-bypass",
    description: "No development/debug auth bypass in production code",
    status: hasBypass ? "fail" : "pass",
    detail: hasBypass
      ? "Found a pattern resembling a development/debug auth bypass — review manually."
      : "No known auth-bypass pattern found in worker/src/index.ts.",
    blocking: hasBypass,
  });
}

// --- Check 9: no secrets in wrangler.toml [vars] -------------------------
function checkWranglerTomlSecrets(): void {
  const tomlFiles = [WORKER_WRANGLER_TOML, WEB_WRANGLER_TOML].filter(existsSync);
  const findings: string[] = [];
  for (const file of tomlFiles) {
    const content = readFileSync(file, "utf8");
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(content)) findings.push(`${name} in ${path.relative(REPO_ROOT, file)}`);
    }
  }
  record({
    id: "wrangler-toml-secrets",
    description: "No secrets committed in wrangler.toml [vars]",
    status: findings.length > 0 ? "fail" : "pass",
    detail: findings.length > 0 ? findings.join("; ") : "No known secret patterns found in wrangler.toml files.",
    blocking: findings.length > 0,
  });
}

// --- Run all checks --------------------------------------------------------
checkD1Jurisdiction();
checkR2Buckets();
checkKvNamespaces();
checkFrontendSecrets();
checkNoStoreOnApi();
checkAuthBypassAndDebug();
checkWranglerTomlSecrets();

// --- Report -----------------------------------------------------------------
const ICONS: Record<CheckResult["status"], string> = { pass: "✅", fail: "❌", warn: "⚠️ ", skip: "⏭️ " };

console.log("\nPrivacy/Security Production Check — Turnen (SQUORA)\n" + "=".repeat(56));
for (const r of results) {
  console.log(`${ICONS[r.status]} [${r.id}] ${r.description}`);
  console.log(`   ${r.detail}\n`);
}

const blockingFailures = results.filter((r) => r.status === "fail" && r.blocking);
console.log("=".repeat(56));
if (blockingFailures.length > 0) {
  console.log(`${blockingFailures.length} blocking finding(s). Deployment should not proceed until reviewed.`);
  process.exit(1);
} else {
  console.log("No blocking findings from the checks this script can perform. See docs/security/cloudflare-production-checklist.md for what still requires manual/dashboard review.");
  process.exit(0);
}
