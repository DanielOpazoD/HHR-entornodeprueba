#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_FEATURES_ROOT = path.join(ROOT, 'src', 'features');
const MATRIX_PATH = path.join(ROOT, 'scripts', 'feature-dependency-matrix.json');
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'feature-dependency-allowlist.json');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const IMPORT_REGEX =
  /(?:^|\n)\s*import(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']|(?:^|\n)\s*export\s+[^;\n]*\sfrom\s*["']([^"']+)["']/g;

const toPosix = value => value.split(path.sep).join('/');

const isFeatureSourceFile = filePath => {
  const extension = path.extname(filePath);
  if (!SOURCE_EXTENSIONS.has(extension)) return false;
  if (filePath.endsWith('.d.ts')) return false;

  const relativePath = toPosix(path.relative(ROOT, filePath));
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
    if (entry.isFile() && isFeatureSourceFile(absolutePath)) {
      files.push(absolutePath);
    }
  }

  return files;
};

const getFeatureNameFromPath = relativePath => {
  const match = relativePath.match(/^src\/features\/([^/]+)\//);
  return match ? match[1] : null;
};

const getDeclaredFeatureNames = () => {
  const entries = fs.readdirSync(SRC_FEATURES_ROOT, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
};

const loadJson = (jsonPath, fallback) => {
  if (!fs.existsSync(jsonPath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
};

const matrix = loadJson(MATRIX_PATH, { features: {}, publicImportPatterns: [] });
const allowlist = loadJson(ALLOWLIST_PATH, { violations: [] });
const knownViolations = new Set(allowlist.violations || []);

const declaredFeatures = getDeclaredFeatureNames();
const configuredFeatures = Object.keys(matrix.features || {}).sort((a, b) => a.localeCompare(b));
const missingInMatrix = declaredFeatures.filter(feature => !configuredFeatures.includes(feature));
const missingInCode = configuredFeatures.filter(feature => !declaredFeatures.includes(feature));

if (missingInMatrix.length > 0 || missingInCode.length > 0) {
  console.error('\nFeature dependency matrix is out of sync with src/features.');
  if (missingInMatrix.length > 0) {
    console.error(`- Missing in matrix: ${missingInMatrix.join(', ')}`);
  }
  if (missingInCode.length > 0) {
    console.error(`- Missing in src/features: ${missingInCode.join(', ')}`);
  }
  process.exit(1);
}

const publicImportPatterns =
  matrix.publicImportPatterns && matrix.publicImportPatterns.length > 0
    ? matrix.publicImportPatterns
    : ['@/features/{feature}', '@/features/{feature}/index', '@/features/{feature}/public'];

const isPublicImportPath = (importPath, importedFeature) =>
  publicImportPatterns
    .map(pattern => pattern.replace('{feature}', importedFeature))
    .includes(importPath) ||
  (matrix.publicImportModulesByFeature?.[importedFeature] || []).includes(importPath);

const files = walkFiles(SRC_FEATURES_ROOT);
const currentViolationIds = [];

for (const absolutePath of files) {
  const importerPath = toPosix(path.relative(ROOT, absolutePath));
  const importerFeature = getFeatureNameFromPath(importerPath);
  if (!importerFeature) continue;

  const source = fs.readFileSync(absolutePath, 'utf8');
  let match;

  while ((match = IMPORT_REGEX.exec(source)) !== null) {
    const importPath = match[1] || match[2];
    if (!importPath || !importPath.startsWith('@/features/')) continue;

    const importedFeature = importPath.slice('@/features/'.length).split('/')[0];
    if (!importedFeature || importedFeature === importerFeature) continue;

    const allowedDependencies = matrix.features[importerFeature] || [];
    if (!allowedDependencies.includes(importedFeature)) {
      currentViolationIds.push(
        `feature-dependency-not-allowed|${importerPath}|${importPath}|${importedFeature}`
      );
      continue;
    }

    if (!isPublicImportPath(importPath, importedFeature)) {
      currentViolationIds.push(
        `feature-must-use-public-api|${importerPath}|${importPath}|${importedFeature}`
      );
    }
  }
}

const newViolations = currentViolationIds.filter(id => !knownViolations.has(id));
if (newViolations.length === 0) {
  console.log('Feature dependency boundary checks passed.');
  if (currentViolationIds.length > 0) {
    console.log(`Baseline debt tracked: ${currentViolationIds.length} feature boundary issues.`);
  }
  process.exit(0);
}

console.error('\nFeature dependency boundary violations:');
for (const violationId of newViolations) {
  const [rule, importer, importPath, importedFeature] = violationId.split('|');
  console.error(`- [${rule}] ${importer} -> ${importPath} (feature: ${importedFeature})`);
}

process.exit(1);
