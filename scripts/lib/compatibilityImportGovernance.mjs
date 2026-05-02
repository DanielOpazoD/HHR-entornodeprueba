#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const IMPORT_EXPORT_REGEX =
  /(?:^|\n)\s*import(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']|(?:^|\n)\s*export\s+[\s\S]*?\sfrom\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_REGEX = /import\(\s*["']([^"']+)["']\s*\)/g;

const toPosix = value => value.split(path.sep).join('/');

const isSourceFile = filePath => {
  const extension = path.extname(filePath);
  if (!SOURCE_EXTENSIONS.has(extension) || filePath.endsWith('.d.ts')) return false;

  const relativePath = toPosix(filePath);
  if (relativePath.includes('/src/tests/')) return false;
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

const resolveImport = (root, importerFilePath, importPath) => {
  if (!importPath.startsWith('@/') && !importPath.startsWith('.')) return null;

  const basePath = importPath.startsWith('@/')
    ? path.join(root, 'src', importPath.slice(2))
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

const scanImporters = (root, governedPaths) => {
  const sourceRoot = path.join(root, 'src');
  const files = walkFiles(sourceRoot);
  const importersByPath = new Map([...governedPaths].map(filePath => [filePath, new Set()]));

  for (const absolutePath of files) {
    const importerPath = toPosix(path.relative(root, absolutePath));
    const source = fs.readFileSync(absolutePath, 'utf8');

    IMPORT_EXPORT_REGEX.lastIndex = 0;
    DYNAMIC_IMPORT_REGEX.lastIndex = 0;

    let match;
    while ((match = IMPORT_EXPORT_REGEX.exec(source)) !== null) {
      const importPath = match[1] || match[2];
      if (!importPath) continue;
      const resolved = resolveImport(root, absolutePath, importPath);
      if (resolved && importersByPath.has(resolved)) {
        importersByPath.get(resolved)?.add(importerPath);
      }
    }

    while ((match = DYNAMIC_IMPORT_REGEX.exec(source)) !== null) {
      const importPath = match[1];
      if (!importPath) continue;
      const resolved = resolveImport(root, absolutePath, importPath);
      if (resolved && importersByPath.has(resolved)) {
        importersByPath.get(resolved)?.add(importerPath);
      }
    }
  }

  return importersByPath;
};

export const buildCompatibilityImportGovernanceReport = root => {
  const configPath = path.join(root, 'scripts', 'config', 'compatibility-governance.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const restrictedEntries = (config.entries || []).filter(entry => entry.importPolicy === 'restricted');
  const governedPaths = new Set(
    restrictedEntries
      .map(entry => path.normalize(path.join(root, entry.path)))
      .filter(absolutePath => fs.existsSync(absolutePath))
  );
  const importersByPath = scanImporters(root, governedPaths);

  const entries = restrictedEntries.map(entry => {
    const absolutePath = path.normalize(path.join(root, entry.path));
    const allowedImporters = Array.isArray(entry.allowedImporters)
      ? entry.allowedImporters
          .filter(importer => typeof importer === 'string' && importer.trim())
          .map(importer => importer.trim())
      : [];
    const actualImporters = [...(importersByPath.get(absolutePath) || new Set())].sort((left, right) =>
      left.localeCompare(right)
    );
    const unauthorizedImporters = actualImporters.filter(
      importer => !allowedImporters.includes(importer)
    );

    return {
      path: entry.path,
      owner: entry.owner,
      kind: entry.kind,
      exists: fs.existsSync(absolutePath),
      allowedImporters,
      actualImporters,
      unauthorizedImporters,
      status: unauthorizedImporters.length === 0 ? 'ok' : 'invalid',
    };
  });

  const issues = entries.flatMap(entry =>
    entry.unauthorizedImporters.map(importer => `${entry.path}: unauthorized importer ${importer}`)
  );

  return {
    generatedAt: new Date().toISOString(),
    policyVersion: config.policyVersion || 'unknown',
    checkedEntries: entries.length,
    entries,
    issues,
  };
};

export const formatCompatibilityImportGovernanceMarkdown = report => {
  const lines = [
    '# Compatibility Import Governance',
    '',
    `Generated at: ${report.generatedAt}`,
    `Policy version: ${report.policyVersion}`,
    `Checked entries: ${report.checkedEntries}`,
    '',
    '| Path | Owner | Kind | Allowed importers | Actual importers | Status |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const entry of report.entries) {
    lines.push(
      `| \`${entry.path}\` | ${entry.owner} | ${entry.kind} | ${
        entry.allowedImporters.length > 0 ? entry.allowedImporters.join('<br/>') : '-'
      } | ${entry.actualImporters.length > 0 ? entry.actualImporters.join('<br/>') : '-'} | ${entry.status} |`
    );
  }

  lines.push('', '## Issues', '');
  if (report.issues.length === 0) {
    lines.push('- none');
  } else {
    for (const issue of report.issues) {
      lines.push(`- ${issue}`);
    }
  }

  return lines.join('\n');
};
