#!/usr/bin/env node

/**
 * Blocks production modules that no entry point of the app reaches.
 *
 * A module imported only by its own tests looks alive: it compiles, it is covered, and other
 * guardrails keep listing it. It ships in no bundle, and every refactor still has to carry it.
 * Seventy-five such modules (6,200 lines) had accumulated when this check was added, some
 * unreachable for seven months.
 *
 * Reachable means: some chain of imports leads to the module from what a browser, Netlify or a
 * build script loads first. Type-only and dynamic imports count, because a module used only as
 * a type or loaded lazily is still in use. Tests and stories are not entry points.
 *
 * Entry points are `index.html`, every file under `netlify/functions`, and the files listed in
 * `scripts/config/unreachable-modules.json` with the place that declares each one. The same
 * file lists what the owner keeps on purpose, with the reason; an entry there that is reachable
 * again, or gone, fails the check so the list cannot go stale.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { listProductionSources, resolveSpecifier } from './lib/sourceModules.mjs';

const ROOT = process.cwd();
const CONFIG_PATH = 'scripts/config/unreachable-modules.json';
const HTML_ENTRY = 'index.html';
const FUNCTIONS_DIR = 'netlify/functions';
const HTML_MODULE_SOURCE = /<script\b[^>]*\bsrc=["']\/(src\/[^"']+)["']/g;
/** `new URL('./x.worker.ts', import.meta.url)`: how Vite is told about a worker file. */
const URL_REFERENCE = /new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g;

const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const exists = relativePath => fs.existsSync(path.join(ROOT, relativePath));

const config = exists(CONFIG_PATH) ? JSON.parse(read(CONFIG_PATH)) : {};
const declaredEntries = (config.entryPoints ?? []).map(entry => entry.file);
const retained = (config.retained ?? []).flatMap(group => group.files);

const appModules = listProductionSources(ROOT, 'src');
const functionModules = listProductionSources(ROOT, FUNCTIONS_DIR);
const modules = new Set([...appModules, ...functionModules]);

const importsOf = file => {
  const source = read(file);
  const specifiers = [
    ...ts.preProcessFile(source, true, true).importedFiles.map(imported => imported.fileName),
    ...[...source.matchAll(URL_REFERENCE)].map(match => match[1]),
  ];
  return specifiers.map(specifier => resolveSpecifier(file, specifier, modules)).filter(Boolean);
};

const htmlEntries = exists(HTML_ENTRY)
  ? [...read(HTML_ENTRY).matchAll(HTML_MODULE_SOURCE)].map(match => match[1])
  : [];
const entries = [...htmlEntries, ...functionModules, ...declaredEntries];

const reached = new Set();
const pending = entries.filter(entry => modules.has(entry));
while (pending.length > 0) {
  const file = pending.pop();
  if (reached.has(file)) continue;
  reached.add(file);
  pending.push(...importsOf(file));
}

const retainedSet = new Set(retained);
const missingEntries = declaredEntries.filter(entry => !modules.has(entry));
const unreachable = appModules.filter(file => !reached.has(file) && !retainedSet.has(file)).sort();
const staleRetained = retained.filter(file => !modules.has(file) || reached.has(file)).sort();

if (missingEntries.length + unreachable.length + staleRetained.length === 0) {
  console.log(
    `Unreachable module check passed (${appModules.length} modules, ${entries.length} entry points, ${retained.length} retained on purpose).`
  );
  process.exit(0);
}

const report = (title, files, fix) => {
  if (files.length === 0) return;
  console.error(`\n${title}`);
  for (const file of files) console.error(`- ${file}`);
  console.error(fix);
};

report(
  'Modules no entry point of the app reaches:',
  unreachable,
  `Delete each one with the tests that only test it, or import it from the app. If the owner keeps it on purpose, list it under "retained" in ${CONFIG_PATH} with the reason.`
);
report(
  'Listed as retained, but reachable again or no longer there:',
  staleRetained,
  `Remove these entries from "retained" in ${CONFIG_PATH}.`
);
report(
  'Declared entry points that do not exist:',
  missingEntries,
  `Fix or remove these under "entryPoints" in ${CONFIG_PATH}.`
);
process.exit(1);
