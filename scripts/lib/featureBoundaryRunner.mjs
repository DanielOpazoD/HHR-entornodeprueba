import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, 'src');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

const IMPORT_EXPORT_REGEX =
  /(?:^|\n)\s*import(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']|(?:^|\n)\s*export\s+[^;\n]*\sfrom\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT_REGEX = /import\(\s*["']([^"']+)["']\s*\)/g;

const toPosix = value => value.split(path.sep).join('/');

const isSourceFile = filePath => {
  const extension = path.extname(filePath);
  if (!SOURCE_EXTENSIONS.has(extension) || filePath.endsWith('.d.ts')) return false;

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

// One invocation-scoped snapshot, never a disk/global cache: the next command
// always sees current files. Multiple feature policies share reads and parsing.
export const collectFeatureBoundarySources = () =>
  walkFiles(SRC_ROOT).map(absolutePath => {
    const source = fs.readFileSync(absolutePath, 'utf8');
    const imports = [];
    IMPORT_EXPORT_REGEX.lastIndex = 0;
    DYNAMIC_IMPORT_REGEX.lastIndex = 0;
    let match;
    while ((match = IMPORT_EXPORT_REGEX.exec(source)) !== null) {
      imports.push(match[1] || match[2]);
    }
    while ((match = DYNAMIC_IMPORT_REGEX.exec(source)) !== null) {
      imports.push(match[1]);
    }
    const resolvedImports = new Map();
    return {
      absolutePath,
      importerPath: toPosix(path.relative(ROOT, absolutePath)),
      source,
      imports,
      resolve: importPath => {
        if (!resolvedImports.has(importPath)) {
          resolvedImports.set(importPath, resolveImport(absolutePath, importPath));
        }
        return resolvedImports.get(importPath);
      },
    };
  });

/**
 * Run a feature-boundary check.
 *
 * @param {object} options
 * @param {string} options.feature           Feature directory name under src/features.
 * @param {string} options.label             Human-readable label for log output.
 * @param {string[]} [options.extraPublicModules] Additional import paths (beyond the
 *                                           default `@/features/<feature>`,
 *                                           `@/features/<feature>/index`,
 *                                           `@/features/<feature>/public`) that are
 *                                           allowed for outside importers.
 * @param {(ctx: { importerPath: string, importPath: string, source: string }) => boolean} [options.allowException]
 *                                           Optional predicate to permit a specific
 *                                           governed importer (e.g. hooks/controllers
 *                                           shims that re-export feature controllers).
 */
export const runFeatureBoundaryCheck = ({
  feature,
  label,
  extraPublicModules = [],
  allowException,
  sources,
}) => {
  if (!feature || !label) {
    throw new Error('runFeatureBoundaryCheck requires `feature` and `label`.');
  }

  const featureRoot = path.normalize(path.join(SRC_ROOT, 'features', feature));
  const publicModules = new Set([
    `@/features/${feature}`,
    `@/features/${feature}/index`,
    `@/features/${feature}/public`,
    ...extraPublicModules,
  ]);

  const violations = [];

  for (const { absolutePath, importerPath, source, imports, resolve } of sources ??
    collectFeatureBoundarySources()) {
    if (absolutePath.startsWith(featureRoot)) continue;

    const checkMatch = importPath => {
      if (!importPath || publicModules.has(importPath)) return;
      if (allowException && allowException({ importerPath, importPath, source })) return;
      const resolved = resolve(importPath);
      if (resolved && resolved.startsWith(featureRoot)) {
        violations.push(`${importerPath} -> ${importPath}`);
      }
    };

    imports.forEach(checkMatch);
  }

  if (violations.length > 0) {
    console.error(`\n${label} feature boundary violations:`);
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exit(1);
  }

  console.log(`${label} feature boundary checks passed.`);
};
