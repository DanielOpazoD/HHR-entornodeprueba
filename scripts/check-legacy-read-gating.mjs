#!/usr/bin/env node
/**
 * Guardrail: every consumer of a legacy READ surface must runtime-gate it.
 *
 * The legacy Firebase bridge is a transitional, read-only boundary. Reads are
 * meant to be skipped when the operator runs without legacy (e.g. local dev with
 * no VITE_LEGACY_FIREBASE_* configured, or VITE_LEGACY_COMPATIBILITY_MODE=disabled);
 * otherwise they error on missing config. The daily-record bridge already gates on
 * isLegacyBridgeEnabled(), but the staff-catalog read bridge once did NOT — so a
 * disabled bridge still hit Firebase and logged a hard error. This check fails CI
 * if any module imports a legacy read bridge without also referencing the gate.
 *
 * Sibling guardrails cover *different* concerns: check:legacy-bridge-boundary
 * restricts who may IMPORT the record bridge service; check:legacy-staff-boundary
 * restricts legacy domain field access. Neither enforces the runtime gate.
 *
 * Limitation (shared with the repo's other string-based guards): detection is
 * textual, so a reference to isLegacyBridgeEnabled() inside a comment counts. The
 * goal is to force the gate into the module, not to prove control-flow coverage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

/** Legacy read-bridge module basenames that must be reached only behind the gate. */
export const LEGACY_READ_BRIDGE_MODULES = ['legacyCatalogReadBridge', 'legacyRecordReadBridge'];

/** The runtime gate every consumer must consult before reading legacy. */
export const LEGACY_GATE_SYMBOL = 'isLegacyBridgeEnabled';

/**
 * Files allowed to relay the legacy read surface without the gate: the legacy
 * implementation modules themselves (they ARE the boundary) and tests.
 */
export const DEFAULT_ALLOWLIST = [
  'src/services/storage/legacyfirebase/',
  'src/services/storage/migration/',
  'src/tests/',
];

const moduleAlternation = LEGACY_READ_BRIDGE_MODULES.join('|');

/** True when `source` statically or dynamically imports a legacy read bridge. */
export const importsLegacyReadBridge = (source) => {
  const staticImport = new RegExp(
    `(?:import|export)\\b[^;]*?from\\s*['"][^'"]*(?:${moduleAlternation})(?:\\.[tj]sx?)?['"]`
  );
  const dynamicImport = new RegExp(
    `import\\(\\s*['"][^'"]*(?:${moduleAlternation})(?:\\.[tj]sx?)?['"]\\s*\\)`
  );
  return staticImport.test(source) || dynamicImport.test(source);
};

/** True when `source` references the runtime gate symbol. */
export const referencesLegacyGate = (source) => source.includes(LEGACY_GATE_SYMBOL);

/**
 * Pure: given a list of POSIX-relative files, an injectable `readFile`, and an
 * allowlist, return the files that import a legacy read bridge but never reference
 * the gate. Injecting readFile keeps it unit-testable with no IO.
 */
export const findUngatedLegacyReads = ({ files, readFile, allowlist = DEFAULT_ALLOWLIST }) => {
  const violations = [];
  for (const rel of files) {
    if (allowlist.some((prefix) => rel.startsWith(prefix))) continue;
    const source = readFile(rel);
    if (!importsLegacyReadBridge(source)) continue;
    if (!referencesLegacyGate(source)) violations.push(rel);
  }
  return violations;
};

const listSourceFiles = (dir) => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(abs));
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name)) || entry.name.endsWith('.d.ts')) continue;
    out.push(path.relative(ROOT, abs).split(path.sep).join('/'));
  }
  return out;
};

const runCli = () => {
  const files = listSourceFiles(SRC_DIR);
  const violations = findUngatedLegacyReads({
    files,
    readFile: (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'),
  });

  if (violations.length > 0) {
    console.error(
      '\n[legacy-read-gating] Ungated legacy reads — these modules import a legacy read ' +
        `bridge (${LEGACY_READ_BRIDGE_MODULES.join(', ')}) but never reference ${LEGACY_GATE_SYMBOL}():`
    );
    for (const file of violations) console.error(`- ${file}`);
    console.error(
      '\nGate the legacy read behind isLegacyBridgeEnabled() (see CatalogRepository.getNurses ' +
        'or legacyRecordBridgeService.bridgeLegacyRecord) so it is skipped when legacy is disabled.'
    );
    process.exit(1);
  }

  console.log(
    `[legacy-read-gating] OK — ${files.length} source file(s) scanned; every legacy read ` +
      `bridge consumer references ${LEGACY_GATE_SYMBOL}().`
  );
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli();
}
