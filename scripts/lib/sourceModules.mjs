/**
 * Listing and resolving the app's source modules, shared by the checks that read the import
 * graph. Paths are POSIX and relative to the repository root.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

export const toPosix = value => value.split(path.sep).join('/');

/** Code that ships: not a test, a story or an ambient type declaration. */
export const isProductionFile = relativePath =>
  !relativePath.startsWith('src/tests/') &&
  !/\.(?:test|spec|stories)\./.test(relativePath) &&
  !relativePath.endsWith('.d.ts');

export const listProductionSources = (root, relativeDir) => {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = toPosix(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) files.push(...listProductionSources(root, relativePath));
    else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name)) && isProductionFile(relativePath))
      files.push(relativePath);
  }
  return files;
};

/** The listed file a specifier points at, or null for packages and files outside the list. */
export const resolveSpecifier = (fromFile, specifier, files) => {
  let base;
  if (specifier.startsWith('@/')) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith('.')) base = toPosix(path.join(path.dirname(fromFile), specifier));
  else return null;
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map(extension => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map(extension => `${base}/index${extension}`),
  ];
  return candidates.find(candidate => files.has(candidate)) ?? null;
};

/** Literal module references, including type-only imports and commented dynamic imports. */
export const readModuleReferences = (source, { includeSideEffects = true } = {}) => {
  const references = ts.preProcessFile(source, true, true).importedFiles;
  if (includeSideEffects) return references;
  const file = ts.createSourceFile(
    'source.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const sideEffects = new Set(
    file.statements
      .filter(statement => ts.isImportDeclaration(statement) && !statement.importClause)
      .map(statement => statement.moduleSpecifier.getStart(file))
  );
  return references.filter(reference => !sideEffects.has(reference.pos));
};
