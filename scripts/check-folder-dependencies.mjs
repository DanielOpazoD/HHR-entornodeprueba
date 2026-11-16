#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readModuleReferences } from './lib/sourceModules.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const toPosix = value => value.split(path.sep).join('/');

const isGovernedCensusControllerShim = ({ importerPath, importPath, importedPath, source }) => {
  if (!importerPath.startsWith('src/hooks/controllers/')) return false;
  if (!importedPath.startsWith('src/features/census/controllers/')) return false;
  if (!importPath.startsWith('@/features/census/controllers/')) return false;

  const importerModule = path.basename(importerPath, path.extname(importerPath));
  const expectedSource = `export * from '@/features/census/controllers/${importerModule}';`;
  return source.trim() === expectedSource;
};

const isSourceFile = (root, filePath) => {
  const extension = path.extname(filePath);
  if (!SOURCE_EXTENSIONS.has(extension)) return false;
  if (filePath.endsWith('.d.ts')) return false;

  const relativePath = toPosix(path.relative(root, filePath));
  if (relativePath.includes('/tests/')) return false;
  if (relativePath.includes('.test.') || relativePath.includes('.spec.')) return false;
  return !relativePath.includes('.stories.');
};

const walkFiles = (root, dirPath) => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, absolutePath));
      continue;
    }
    if (entry.isFile() && isSourceFile(root, absolutePath)) {
      files.push(absolutePath);
    }
  }

  return files;
};

const loadJson = (jsonPath, fallback) => {
  if (!fs.existsSync(jsonPath)) return fallback;
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
};

const resolveImport = (srcRoot, importerFilePath, importPath) => {
  if (!importPath.startsWith('@/') && !importPath.startsWith('.')) return null;

  const basePath = importPath.startsWith('@/')
    ? path.join(srcRoot, importPath.slice(2))
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

const fail = lines => ({ status: 1, stdout: '', stderr: `${lines.join('\n')}\n` });

/** Checks the folder matrix in the repository at `root`, as the command prints and exits. */
export const checkFolderDependencies = (root = process.cwd()) => {
  const matrix = loadJson(path.join(root, 'scripts', 'folder-dependency-matrix.json'), {
    zones: {},
  });
  const knownZones = new Set(Object.keys(matrix.zones || {}));

  if (knownZones.size === 0) {
    return fail(['Folder dependency matrix has no configured zones.']);
  }

  for (const [zone, config] of Object.entries(matrix.zones || {})) {
    const allowed = config?.allowedDependencies;
    if (!Array.isArray(allowed)) {
      return fail([
        `Invalid matrix config for zone "${zone}": allowedDependencies must be an array.`,
      ]);
    }
  }

  const srcRoot = path.join(root, 'src');
  const files = walkFiles(root, srcRoot);
  const currentViolationIds = [];
  const violationLines = new Map();

  for (const absolutePath of files) {
    const importerPath = toPosix(path.relative(root, absolutePath));
    const importerZone = getZoneFromPath(importerPath, knownZones);
    if (!importerZone) continue;

    const source = fs.readFileSync(absolutePath, 'utf8');
    const references = readModuleReferences(source);

    for (const reference of references) {
      const importPath = reference.fileName;
      if (!importPath) continue;

      const resolvedPath = resolveImport(srcRoot, absolutePath, importPath);
      if (!resolvedPath) continue;

      const importedPath = toPosix(path.relative(root, resolvedPath));
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

  // There is no exception list: every import outside the matrix fails.
  const violations = [...new Set(currentViolationIds)].sort();
  if (violations.length === 0) {
    return { status: 0, stdout: 'Folder dependency matrix checks passed.\n', stderr: '' };
  }

  const lines = ['\nFolder dependency boundary violations:'];
  for (const violationId of violations) {
    const [, importerPath, importPath, , importerZone, importedZone] = violationId.split('|');
    lines.push(
      `- ${importerPath}:${violationLines.get(violationId)} ${importerZone} -> ${importedZone} (${importPath})`
    );
    lines.push(
      '  Mover el import a una zona permitida por scripts/folder-dependency-matrix.json; no hay lista de excepciones y cambiar la matriz es decisión del responsable.'
    );
  }
  return fail(lines);
};

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const { status, stdout, stderr } = checkFolderDependencies();
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exitCode = status;
}
