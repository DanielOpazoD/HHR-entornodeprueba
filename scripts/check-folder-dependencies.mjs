#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { readModuleReferences } from './lib/sourceModules.mjs';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const MATRIX_PATH = path.join(ROOT, 'scripts', 'folder-dependency-matrix.json');
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'folder-dependency-allowlist.json');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const UPDATE_ALLOWLIST = process.argv.includes('--update-allowlist');

const toPosix = value => value.split(path.sep).join('/');

const isGovernedCensusControllerShim = ({ importerPath, importPath, importedPath, source }) => {
  if (!importerPath.startsWith('src/hooks/controllers/')) return false;
  if (!importedPath.startsWith('src/features/census/controllers/')) return false;
  if (!importPath.startsWith('@/features/census/controllers/')) return false;

  const importerModule = path.basename(importerPath, path.extname(importerPath));
  const expectedSource = `export * from '@/features/census/controllers/${importerModule}';`;
  return source.trim() === expectedSource;
};

const isSourceFile = filePath => {
  const extension = path.extname(filePath);
  if (!SOURCE_EXTENSIONS.has(extension)) return false;
  if (filePath.endsWith('.d.ts')) return false;

  const relativePath = toPosix(path.relative(ROOT, filePath));
  if (relativePath.includes('/tests/')) return false;
  if (relativePath.includes('.test.') || relativePath.includes('.spec.')) return false;
  return !relativePath.includes('.stories.');
};

const walkFiles = dirPath => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && isSourceFile(absolutePath)) {
      files.push(absolutePath);
    }
  }

  return files;
};

const loadJson = (jsonPath, fallback) => {
  if (!fs.existsSync(jsonPath)) return fallback;
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
};

const resolveImport = (importerFilePath, importPath) => {
  if (!importPath.startsWith('@/') && !importPath.startsWith('.')) return null;

  const basePath = importPath.startsWith('@/')
    ? path.join(SRC_ROOT, importPath.slice(2))
    : path.resolve(path.dirname(importerFilePath), importPath);

  const candidates = [];
  if (path.extname(basePath)) {
    candidates.push(basePath);
  } else {
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.push(`${basePath}${extension}`);
    }
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.push(path.join(basePath, `index${extension}`));
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.normalize(candidate);
    }
  }

  return null;
};

const getZoneFromPath = (relativePath, knownZones) => {
  const normalized = toPosix(relativePath);
  const parts = normalized.replace(/^src\//, '').split('/');
  const zone = parts[0];
  return knownZones.has(zone) ? zone : null;
};

const matrix = loadJson(MATRIX_PATH, { zones: {} });
const allowlist = loadJson(ALLOWLIST_PATH, { violations: [] });
const knownViolations = new Set(allowlist.violations || []);
const knownZones = new Set(Object.keys(matrix.zones || {}));

if (knownZones.size === 0) {
  console.error('Folder dependency matrix has no configured zones.');
  process.exit(1);
}

for (const [zone, config] of Object.entries(matrix.zones || {})) {
  const allowed = config?.allowedDependencies;
  if (!Array.isArray(allowed)) {
    console.error(
      `Invalid matrix config for zone "${zone}": allowedDependencies must be an array.`
    );
    process.exit(1);
  }
}

const files = walkFiles(SRC_ROOT);
const currentViolationIds = [];
const violationLines = new Map();

for (const absolutePath of files) {
  const importerPath = toPosix(path.relative(ROOT, absolutePath));
  const importerZone = getZoneFromPath(importerPath, knownZones);
  if (!importerZone) continue;

  const source = fs.readFileSync(absolutePath, 'utf8');
  const references = readModuleReferences(source);

  for (const reference of references) {
    const importPath = reference.fileName;
    if (!importPath) continue;

    const resolvedPath = resolveImport(absolutePath, importPath);
    if (!resolvedPath) continue;

    const importedPath = toPosix(path.relative(ROOT, resolvedPath));
    const importedZone = getZoneFromPath(importedPath, knownZones);
    if (!importedZone || importedZone === importerZone) continue;

    if (
      isGovernedCensusControllerShim({
        importerPath,
        importPath,
        importedPath,
        source,
      })
    ) {
      continue;
    }

    const allowedDependencies = matrix.zones[importerZone]?.allowedDependencies || [];
    if (!allowedDependencies.includes(importedZone)) {
      const id = `folder-dependency-not-allowed|${importerPath}|${importPath}|${importedPath}|${importerZone}|${importedZone}`;
      currentViolationIds.push(id);
      violationLines.set(id, source.slice(0, reference.pos).split('\n').length);
    }
  }
}

const sortedCurrentViolationIds = [...new Set(currentViolationIds)].sort();

if (UPDATE_ALLOWLIST) {
  fs.writeFileSync(
    ALLOWLIST_PATH,
    `${JSON.stringify({ violations: sortedCurrentViolationIds }, null, 2)}\n`,
    'utf8'
  );
  console.log(
    `Folder dependency allowlist updated with ${sortedCurrentViolationIds.length} violations.`
  );
  process.exit(0);
}

const newViolations = sortedCurrentViolationIds.filter(id => !knownViolations.has(id));
if (newViolations.length === 0) {
  console.log('Folder dependency matrix checks passed.');
  if (sortedCurrentViolationIds.length > 0) {
    console.log(
      `Baseline debt tracked: ${sortedCurrentViolationIds.length} folder boundary issues.`
    );
  }
  process.exit(0);
}

console.error('\nFolder dependency boundary violations:');
for (const violationId of newViolations) {
  const [, importerPath, importPath, , importerZone, importedZone] = violationId.split('|');
  console.error(
    `- ${importerPath}:${violationLines.get(violationId)} ${importerZone} -> ${importedZone} (${importPath})`
  );
  console.error(
    '  Mover el import a una zona permitida por scripts/folder-dependency-matrix.json; la lista de deuda conocida no se amplía sin decisión del responsable.'
  );
}

process.exit(1);
