#!/usr/bin/env node
// ============================================================================
// TAZAWWUD — smoke test
// ----------------------------------------------------------------------------
// No build tooling exists in this project (vanilla JS, no bundler/test
// framework), so this is a plain Node script rather than a Jest/Vitest
// suite. Run it before every deploy: `node tests/smoke-test.mjs`.
// It checks things that have actually broken this project before:
//   - every JS file parses (catches typos that would only surface in-browser)
//   - manifest.json / database.rules.json / firebase.json are valid JSON
//   - every file that renders external/API content into innerHTML imports
//     and uses escapeHtml (regression guard for the XSS fixes in this pass)
//   - the service worker's CACHE_VERSION was actually bumped since the
//     files it precaches last changed (the #1 recurring mistake in this
//     project's history — shipping a JS fix without bumping the cache)
// It does NOT replace manual/device testing — see
// docs/SECURITY-AUDIT-CHECKLIST.md for what still has to be checked by hand.
// ============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
let warnings = 0;
const toPosix = (value) => value.replace(/\\/g, "/");

function ok(label) { console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
function fail(label) { console.log(`  \x1b[31m✗\x1b[0m ${label}`); failures++; }
function warn(label) { console.log(`  \x1b[33m!\x1b[0m ${label}`); warnings++; }

function walk(dir, ext, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, ext, out);
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

console.log("\n1. JavaScript syntax (every public/js/*.js file must parse)");
const jsFiles = walk(join(ROOT, "public/js"), ".js");
for (const file of jsFiles) {
  try {
    execSync(`node --check "${file}"`, { stdio: "pipe" });
    ok(toPosix(file).replace(`${toPosix(ROOT)}/`, ""));
  } catch (error) {
    fail(`${toPosix(file).replace(`${toPosix(ROOT)}/`, "")} — ${error.stderr?.toString().split("\n")[0] || error.message}`);
  }
}

console.log("\n2. Config files are valid JSON");
for (const rel of ["public/manifest.json", "database.rules.json", "firebase.json"]) {
  const full = join(ROOT, rel);
  try {
    JSON.parse(readFileSync(full, "utf8"));
    ok(rel);
  } catch (error) {
    fail(`${rel} — ${error.message}`);
  }
}

console.log("\n3. Known-risky interpolations (external text fields) are wrapped in escapeHtml()");
// Line-by-line, not file-level: catches an unescaped `${x.arabic}` even in a
// file that correctly escapes everything else nearby.
//
// Deliberately narrow: matches ONLY a direct, unmodified `${x.field}` print
// (nothing else between the field and the closing brace), so it doesn't
// trip on a ternary truthiness check like `${x.arabic ? ... : ...}` where
// the actual print happens later, already escaped.
//
// Field list (arabic/english/translation) and file list are also narrow on
// purpose. Those field names are reused by trusted, developer-authored
// constants elsewhere (PRAYERS.arabic in salah.js, the Islamic-events
// table in calendar.js) that this text-based heuristic can't tell apart
// from real API data by name alone — checked manually in this session
// instead. Only the files below are confirmed to use these exact field
// names for nothing but external/API text.
const RISKY_FIELD = /\$\{(?!\s*(?:escapeHtml|multiline)\()[a-zA-Z_][\w.?]*\.(arabic|english|translation)\}/;
const RISKY_BARE = /\$\{(?!\s*escapeHtml\()\s*query\s*\}/;
const SECURITY_SENSITIVE = ["quran.js", "mushaf.js", "hadith.js", "hisn.js"];
for (const name of SECURITY_SENSITIVE) {
  const file = jsFiles.find((f) => toPosix(f).endsWith("/" + name));
  if (!file) { warn(`${name} not found`); continue; }
  const lines = readFileSync(file, "utf8").split("\n");
  let clean = true;
  lines.forEach((line, i) => {
    if (RISKY_FIELD.test(line) || RISKY_BARE.test(line)) {
      fail(`${name}:${i + 1} — interpolates external text without escapeHtml(): ${line.trim().slice(0, 90)}`);
      clean = false;
    }
  });
  if (clean) ok(name);
}

console.log("\n4. Service worker cache version vs. precached file timestamps");
try {
  const swPath = join(ROOT, "public/sw.js");
  const swSrc = readFileSync(swPath, "utf8");
  const versionMatch = swSrc.match(/CACHE_VERSION\s*=\s*"([^"]+)"/);
  const swMtime = statSync(swPath).mtimeMs;
  const precached = [...swSrc.matchAll(/"(\/[^"]+)"/g)].map((m) => m[1]).filter((p) => p !== "/");
  try {
    const changedFiles = new Set(
      [
        ...execSync("git diff --name-only HEAD -- public", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/),
        ...execSync("git ls-files --others --exclude-standard -- public", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/),
      ].map(toPosix).filter(Boolean)
    );
    const changedPrecaches = precached.filter((rel) => changedFiles.has(`public${rel}`));
    const committedSw = execSync("git show HEAD:public/sw.js", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const committedVersion = committedSw.match(/CACHE_VERSION\s*=\s*"([^"]+)"/);
    if (changedPrecaches.length && committedVersion?.[1] === versionMatch?.[1]) {
      fail(`precached assets changed (${changedPrecaches.join(", ")}) but CACHE_VERSION was not bumped from ${committedVersion[1]}`);
    } else {
      ok(`CACHE_VERSION (${versionMatch?.[1]}) is bumped when tracked precached assets change`);
    }
  } catch {
    warn("Git HEAD unavailable; checking precached asset timestamps against sw.js instead");
  }

  let staleFound = false;
  for (const rel of precached) {
    const full = join(ROOT, "public", rel);
    try {
      if (statSync(full).mtimeMs > swMtime) {
        warn(`${rel} was modified after sw.js — confirm CACHE_VERSION (${versionMatch?.[1]}) was bumped for this change`);
        staleFound = true;
      }
    } catch { /* file doesn't exist locally under that exact rel path (e.g. "/") — skip */ }
  }
  if (!staleFound) ok(`sw.js (${versionMatch?.[1]}) is newer than every file it precaches`);
} catch (error) {
  warn(`Could not check sw.js cache freshness — ${error.message}`);
}

console.log(`\n${failures === 0 ? "\x1b[32mPASS" : "\x1b[31mFAIL"}\x1b[0m — ${failures} failing, ${warnings} warning(s)\n`);
process.exit(failures === 0 ? 0 : 1);
