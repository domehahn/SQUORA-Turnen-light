#!/usr/bin/env -S npx tsx
/**
 * Automated (technical-only) production-readiness gate for the Turnen
 * (SQUORA) app. Complements scripts/privacy-check.ts (which focuses on
 * live Cloudflare config via wrangler) with static, repo-only checks that
 * don't need network access or credentials - safe to run in CI on every
 * push/PR.
 *
 * This script does NOT and cannot verify:
 * - GitHub branch protection (see docs/operations/github-production-settings.md)
 * - Live Cloudflare dashboard settings (Cache Rules, WAF, Access)
 * - Legal/organizational gates (DPA, Datenschutzerklärung, VVT, DSFA)
 * These remain MANUAL GATES - see PRODUCTION_GO_LIVE_REPORT.md.
 *
 * Usage: npx tsx scripts/production-readiness-check.ts
 * Exit code 0 = all technical checks pass. Non-zero = at least one failed.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

interface CheckResult {
  id: string;
  description: string;
  status: "pass" | "fail" | "warn";
  detail: string;
}

const results: CheckResult[] = [];
function record(r: CheckResult): void {
  results.push(r);
}

const REPO_ROOT = path.resolve(__dirname, "..");
const WORKER_DIR = path.join(REPO_ROOT, "turnen", "worker");
const WORKER_SRC = path.join(WORKER_DIR, "src");
const FRONTEND_DIR = path.join(REPO_ROOT, "turnen");
const FRONTEND_SRC = path.join(FRONTEND_DIR, "src");
const IAC_DIR = path.join(REPO_ROOT, "cloudflare-turnen-iac");
const WORKER_WRANGLER = path.join(WORKER_DIR, "wrangler.toml");
const WEB_WRANGLER = path.join(FRONTEND_DIR, "wrangler.toml");

function readIfExists(file: string): string | null {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function walkFiles(dir: string, extPattern: RegExp, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkFiles(full, extPattern, out);
    else if (extPattern.test(entry)) out.push(full);
  }
}

// --- kein health_notes / children.notes -----------------------------------
// Prüft nur AKTIVEN Code (worker/src), nicht die Migrationshistorie - die
// enthält absichtlich die Migrationen, die health_notes/notes ENTFERNT
// haben (0033/0034), deren Dateinamen/Kommentare das Feld naturgemäß
// erwähnen. Innerhalb von worker/src werden reine Kommentarzeilen (die die
// historische Entfernung erklären) ignoriert - nur tatsächliche
// Code-Verwendung (Property-Zugriff, SQL, Interface-Felder) zählt.
function checkNoHealthOrNotesFields(): void {
  const files: string[] = [];
  walkFiles(WORKER_SRC, /\.(ts)$/, files);
  const pattern = /\b(health_notes|children\.notes|medical_notes|diagnosis|medication)\b/i;
  const hits: string[] = [];
  for (const f of files) {
    const codeLines = readFileSync(f, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"));
    if (codeLines.some((line) => pattern.test(line))) hits.push(path.relative(REPO_ROOT, f));
  }
  record({
    id: "no-health-or-notes-fields",
    description: "Keine health_notes/children.notes/medizinischen Felder im aktiven Code",
    status: hits.length > 0 ? "fail" : "pass",
    detail: hits.length > 0 ? `Treffer (außerhalb von Kommentaren) in: ${hits.join(", ")}` : "Keine Code-Treffer in worker/src (Migrationshistorie 0033/0034 dokumentiert die Entfernung, wird bewusst nicht geprüft).",
  });
}

// --- keine sensitive API PWA Caches -----------------------------------------
function checkNoApiPwaCaching(): void {
  const viteConfig = readIfExists(path.join(FRONTEND_DIR, "vite.config.ts"));
  if (!viteConfig) {
    record({ id: "no-api-pwa-cache", description: "Kein PWA-Caching für /api/*", status: "warn", detail: "vite.config.ts nicht gefunden." });
    return;
  }
  // Leeres Array ist der erwartete, sichere Zustand - direkt als Treffer
  // werten, statt den nachfolgenden Dateiinhalt (z.B. den unabhängigen
  // Vite-Dev-Server-Proxy-Eintrag "/api": {...} weiter unten in derselben
  // Datei) fälschlich mit auszuwerten.
  const emptyArray = /runtimeCaching\s*:\s*\[\s*\]/.test(viteConfig);
  let hasApiRuntimeCaching = false;
  if (!emptyArray) {
    // Nur den Inhalt des runtimeCaching-Arrays selbst (bis zur ersten
    // schließenden Klammer auf oberster Ebene danach) nach /api durchsuchen.
    const match = viteConfig.match(/runtimeCaching\s*:\s*\[([\s\S]*?)\]\s*,?\s*\n\s*\}/);
    hasApiRuntimeCaching = Boolean(match && /\/api/i.test(match[1]));
  }
  record({
    id: "no-api-pwa-cache",
    description: "Kein PWA-Caching (runtimeCaching) für /api/*",
    status: hasApiRuntimeCaching ? "fail" : "pass",
    detail: emptyArray
      ? "workbox.runtimeCaching ist ein leeres Array - keine API-Responses werden vom Service Worker gecacht."
      : hasApiRuntimeCaching
        ? "workbox.runtimeCaching enthält ein Muster, das /api/* zu treffen scheint."
        : "Kein /api/*-Muster innerhalb von workbox.runtimeCaching gefunden.",
  });
}

// --- workers_dev / preview_urls ---------------------------------------------
function checkWorkersDevDisabled(file: string, label: string): void {
  const content = readIfExists(file);
  if (!content) {
    record({ id: `workers-dev-${label}`, description: `${label}: workers_dev=false`, status: "warn", detail: `${file} nicht gefunden.` });
    return;
  }
  const workersDevMatch = content.match(/^workers_dev\s*=\s*(true|false)/m);
  const previewUrlsMatch = content.match(/^preview_urls\s*=\s*(true|false)/m);
  const workersDevOk = workersDevMatch?.[1] === "false";
  const previewUrlsOk = previewUrlsMatch?.[1] === "false";
  record({
    id: `workers-dev-${label}`,
    description: `${label}: workers_dev=false und preview_urls=false`,
    status: workersDevOk && previewUrlsOk ? "pass" : "fail",
    detail: `workers_dev=${workersDevMatch?.[1] ?? "nicht gesetzt (Default true)"}, preview_urls=${previewUrlsMatch?.[1] ?? "nicht gesetzt (Default true)"}`,
  });
}

// --- D1 zeigt auf turnen-eu ---------------------------------------------
function checkD1DatabaseName(): void {
  const content = readIfExists(WORKER_WRANGLER);
  if (!content) {
    record({ id: "d1-database-name", description: "D1 database_name = turnen-eu", status: "fail", detail: "worker/wrangler.toml nicht gefunden." });
    return;
  }
  const match = content.match(/database_name\s*=\s*"([^"]+)"/);
  const ok = match?.[1] === "turnen-eu";
  record({
    id: "d1-database-name",
    description: "D1 database_name = turnen-eu",
    status: ok ? "pass" : "fail",
    detail: `Gefunden: database_name = "${match?.[1] ?? "nicht gefunden"}"`,
  });
}

// --- EU jurisdiction in IaC ------------------------------------------------
function checkIacEuJurisdiction(): void {
  const content = readIfExists(path.join(IAC_DIR, "storage.tf"));
  if (!content) {
    record({ id: "iac-eu-jurisdiction", description: "IaC: D1 jurisdiction = eu", status: "fail", detail: "cloudflare-turnen-iac/storage.tf nicht gefunden." });
    return;
  }
  const ok = /jurisdiction\s*=\s*"eu"/.test(content);
  record({
    id: "iac-eu-jurisdiction",
    description: "IaC: D1 jurisdiction = eu",
    status: ok ? "pass" : "fail",
    detail: ok ? 'storage.tf setzt jurisdiction = "eu".' : "Kein jurisdiction = \"eu\" in storage.tf gefunden.",
  });
}

// --- prevent_destroy ---------------------------------------------------------
function checkIacPreventDestroy(): void {
  const content = readIfExists(path.join(IAC_DIR, "storage.tf"));
  if (!content) {
    record({ id: "iac-prevent-destroy", description: "IaC: prevent_destroy = true für D1", status: "fail", detail: "storage.tf nicht gefunden." });
    return;
  }
  const ok = /prevent_destroy\s*=\s*true/.test(content);
  record({
    id: "iac-prevent-destroy",
    description: "IaC: prevent_destroy = true für D1",
    status: ok ? "pass" : "fail",
    detail: ok ? "lifecycle.prevent_destroy = true gefunden." : "Kein prevent_destroy = true in storage.tf gefunden.",
  });
}

// --- Retention Production Variable ------------------------------------------
function checkRetentionVariable(): void {
  const content = readIfExists(WORKER_WRANGLER);
  if (!content) {
    record({ id: "retention-variable", description: "ARCHIVED_CHILD_RETENTION_DAYS in Production gesetzt", status: "fail", detail: "worker/wrangler.toml nicht gefunden." });
    return;
  }
  const ok = /^ARCHIVED_CHILD_RETENTION_DAYS\s*=\s*"\d+"/m.test(content);
  record({
    id: "retention-variable",
    description: "ARCHIVED_CHILD_RETENTION_DAYS in Production gesetzt (nicht auskommentiert)",
    status: ok ? "pass" : "fail",
    detail: ok ? "Gesetzt in wrangler.toml." : "Nicht gesetzt oder auskommentiert - LEGAL/PRIVACY RETENTION VALUE REQUIRED, s. PRIVACY_SECURITY_GAP_ANALYSIS.md.",
  });
  const securityLogOk = /^SECURITY_LOG_RETENTION_DAYS\s*=\s*"\d+"/m.test(content);
  record({
    id: "security-log-retention-variable",
    description: "SECURITY_LOG_RETENTION_DAYS in Production gesetzt",
    status: securityLogOk ? "pass" : "fail",
    detail: securityLogOk ? "Gesetzt in wrangler.toml." : "Nicht gesetzt - Security-Tabellen (sessions/login_attempts/...) würden unbegrenzt wachsen.",
  });
}

// --- CSP vorhanden -----------------------------------------------------------
function checkCsp(): void {
  const content = readIfExists(path.join(FRONTEND_DIR, "cloudflare", "web-router.ts"));
  if (!content) {
    record({ id: "csp-present", description: "Content-Security-Policy-Header gesetzt", status: "fail", detail: "turnen/cloudflare/web-router.ts nicht gefunden." });
    return;
  }
  const ok = /content-security-policy/i.test(content) && /default-src/i.test(content);
  const noUnsafeEval = !/unsafe-eval/i.test(content);
  record({
    id: "csp-present",
    description: "Content-Security-Policy-Header gesetzt, kein unsafe-eval",
    status: ok && noUnsafeEval ? "pass" : "fail",
    detail: ok ? (noUnsafeEval ? "CSP-Header vorhanden, kein unsafe-eval." : "CSP vorhanden, aber unsafe-eval gefunden!") : "Kein CSP-Header gefunden.",
  });
}

// --- HttpOnly Session Modell / kein JWT localStorage ------------------------
function checkHttpOnlySessionModel(): void {
  const indexTs = readIfExists(path.join(WORKER_SRC, "index.ts"));
  const httpOnlyOk = Boolean(indexTs && /httpOnly\s*:\s*true/.test(indexTs));
  record({
    id: "httponly-session-cookie",
    description: "Session-Cookie ist HttpOnly",
    status: httpOnlyOk ? "pass" : "fail",
    detail: httpOnlyOk ? "httpOnly: true in worker/src/index.ts gefunden." : "Kein httpOnly: true gefunden.",
  });

  const files: string[] = [];
  walkFiles(FRONTEND_SRC, /\.(ts|tsx)$/, files);
  const suspicious: string[] = [];
  for (const f of files) {
    const content = readFileSync(f, "utf8");
    // localStorage.setItem/getItem mit einem Key, der nach Token/JWT/Session aussieht.
    const matches = content.match(/localStorage\.(setItem|getItem)\(\s*["'`][^"'`]*(token|jwt|session)[^"'`]*["'`]/gi);
    if (matches) suspicious.push(`${path.relative(REPO_ROOT, f)}: ${matches.join(", ")}`);
  }
  record({
    id: "no-jwt-localstorage",
    description: "Kein JWT/Session-Token in localStorage",
    status: suspicious.length > 0 ? "fail" : "pass",
    detail: suspicious.length > 0 ? suspicious.join("; ") : "Kein verdächtiges localStorage-Muster im Frontend-Quellcode gefunden.",
  });
}

// --- kein Secret in Source/Frontend Build -----------------------------------
const SECRET_PATTERNS: RegExp[] = [
  /jwt[_-]?secret\s*[:=]\s*["'][^"']{10,}["']/i,
  /api[_-]?key\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/i,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
  /cfat_[A-Za-z0-9_-]{20,}/, // Cloudflare API Token-artiges Muster
];

function checkNoSecretsInSource(): void {
  const files: string[] = [];
  walkFiles(WORKER_SRC, /\.(ts)$/, files);
  walkFiles(FRONTEND_SRC, /\.(ts|tsx)$/, files);
  for (const tomlFile of [WORKER_WRANGLER, WEB_WRANGLER]) if (existsSync(tomlFile)) files.push(tomlFile);
  const distDir = path.join(FRONTEND_DIR, "dist");
  if (existsSync(distDir)) walkFiles(distDir, /\.(js|css|html|map)$/, files);

  const hits: string[] = [];
  for (const f of files) {
    const content = readFileSync(f, "utf8");
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) hits.push(`${path.relative(REPO_ROOT, f)} (${pattern})`);
    }
  }
  record({
    id: "no-secrets-in-source",
    description: "Keine Secrets im Quellcode/Frontend-Build",
    status: hits.length > 0 ? "fail" : "pass",
    detail: hits.length > 0 ? hits.join("; ") : `Gescannt: worker/src, frontend src, wrangler.toml-Dateien${existsSync(distDir) ? ", dist/" : " (dist/ nicht gebaut - vor Deploy erneut mit Build laufen lassen)"}.`,
  });
}

// --- kein sensitives console.log --------------------------------------------
function checkNoSensitiveConsoleLog(): void {
  const files: string[] = [];
  walkFiles(WORKER_SRC, /\.(ts)$/, files);
  const pattern = /console\.(log|error|warn|debug)\([^)]*\b(password|totp_secret|backup_codes|emergency_?contact|contact_email|contact_phone|jwt_secret|encryption_key)\b/i;
  const hits: string[] = [];
  for (const f of files) {
    const content = readFileSync(f, "utf8");
    if (pattern.test(content)) hits.push(path.relative(REPO_ROOT, f));
  }
  record({
    id: "no-sensitive-console-log",
    description: "Kein offensichtliches Logging sensibler Felder",
    status: hits.length > 0 ? "fail" : "pass",
    detail: hits.length > 0 ? `Verdächtige console.*-Aufrufe in: ${hits.join(", ")}` : "Keine verdächtigen console.*-Aufrufe mit sensiblen Feldnamen gefunden.",
  });
}

// --- CI Security Jobs vorhanden ---------------------------------------------
function checkCiSecurityJobs(): void {
  const ciFile = readIfExists(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"));
  if (!ciFile) {
    record({ id: "ci-security-jobs", description: "CI enthält einen Security-Job (SAST/SCA/Secret-Scan/IaC-Scan)", status: "fail", detail: ".github/workflows/ci.yml nicht gefunden." });
    return;
  }
  const hasSecurityJob = /^\s{2}security/m.test(ciFile) || /codeql|gitleaks|trivy|npm audit/i.test(ciFile);
  record({
    id: "ci-security-jobs",
    description: "CI enthält einen Security-Job (SAST/SCA/Secret-Scan/IaC-Scan)",
    status: hasSecurityJob ? "pass" : "fail",
    detail: hasSecurityJob ? "Security-bezogene Schritte in ci.yml gefunden." : "Keine Security-Jobs in ci.yml gefunden.",
  });
  const permissionsOk = /^permissions:\s*$/m.test(ciFile) && /contents:\s*read/.test(ciFile);
  record({
    id: "ci-minimal-permissions",
    description: "CI-Workflow setzt minimale Standard-Berechtigungen (permissions: contents: read)",
    status: permissionsOk ? "pass" : "fail",
    detail: permissionsOk ? "Top-level permissions-Block mit contents: read gefunden." : "Kein Top-level permissions-Block gefunden.",
  });
  const shaPinned = !/uses:\s*[\w-]+\/[\w.-]+@v\d/.test(ciFile);
  record({
    id: "ci-actions-sha-pinned",
    description: "GitHub Actions sind auf vollständige Commit-SHAs gepinnt (kein @v4 o.ä.)",
    status: shaPinned ? "pass" : "fail",
    detail: shaPinned ? "Keine @vX-Tags in uses:-Zeilen gefunden." : "Mindestens eine Action ist noch auf ein mutable Tag (@vX) statt auf eine SHA gepinnt.",
  });
}

// --- Run all checks ----------------------------------------------------------
checkNoHealthOrNotesFields();
checkNoApiPwaCaching();
checkWorkersDevDisabled(WORKER_WRANGLER, "API-Worker");
checkWorkersDevDisabled(WEB_WRANGLER, "Web-Worker");
checkD1DatabaseName();
checkIacEuJurisdiction();
checkIacPreventDestroy();
checkRetentionVariable();
checkCsp();
checkHttpOnlySessionModel();
checkNoSecretsInSource();
checkNoSensitiveConsoleLog();
checkCiSecurityJobs();

// --- Report --------------------------------------------------------------
const ICONS: Record<CheckResult["status"], string> = { pass: "✅", fail: "❌", warn: "⚠️ " };
console.log("\nProduction Readiness Check (technical) — Turnen (SQUORA)\n" + "=".repeat(58));
for (const r of results) {
  console.log(`${ICONS[r.status]} [${r.id}] ${r.description}`);
  console.log(`   ${r.detail}\n`);
}

const failures = results.filter((r) => r.status === "fail");
console.log("=".repeat(58));
if (failures.length > 0) {
  console.log(`${failures.length} check(s) FAILED. Production Gate: FAIL.`);
  console.log("Manual/legal gates (branch protection, Cloudflare dashboard, DPA, Datenschutzerklärung, ...) are NOT covered by this script - see PRODUCTION_GO_LIVE_REPORT.md.");
  process.exit(1);
} else {
  console.log("All technical checks passed. This does NOT mean the app is legally/organizationally production-ready - see PRODUCTION_GO_LIVE_REPORT.md for manual gates.");
  process.exit(0);
}
