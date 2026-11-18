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
export const readModuleReferences = source => ts.preProcessFile(source, true, true).importedFiles;

const isTypeOnlyImport = clause => {
  if (!clause) return false; // `import 'x'` runs the module.
  if (clause.isTypeOnly) return true;
  if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings))
    return false;
  const { elements } = clause.namedBindings;
  return elements.length > 0 && elements.every(element => element.isTypeOnly);
};

const isTypeOnlyExport = node =>
  node.isTypeOnly ||
  Boolean(
    node.exportClause &&
    ts.isNamedExports(node.exportClause) &&
    node.exportClause.elements.length > 0 &&
    node.exportClause.elements.every(element => element.isTypeOnly)
  );

const isImportMetaUrl = node =>
  ts.isPropertyAccessExpression(node) &&
  ts.isMetaProperty(node.expression) &&
  node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
  node.name.text === 'url';

/**
 * Every literal module reference of a source file, with what it costs at runtime:
 * - `type`: erased when compiling (`import type`, `export type`, every named specifier marked
 *   `type`, or `import('x').T` in a type position);
 * - `value`: evaluated when the importing module loads (imports, side-effect imports, re-exports);
 * - `deferred`: loaded later, by `import('x')` or by `new URL('x', import.meta.url)`, which is
 *   how Vite is told about a worker.
 * Comments, strings and non-literal specifiers are not references.
 */
export const readClassifiedReferences = (fileName, source) => {
  const tree = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    /x$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const references = [];
  const add = (literal, kind) =>
    references.push({
      specifier: literal.text,
      kind,
      line: tree.getLineAndCharacterOfPosition(literal.getStart(tree)).line + 1,
    });
  const visit = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier, isTypeOnlyImport(node.importClause) ? 'type' : 'value');
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(node.moduleSpecifier, isTypeOnlyExport(node) ? 'type' : 'value');
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      add(node.moduleReference.expression, node.isTypeOnly ? 'type' : 'value');
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      add(node.arguments[0], 'deferred');
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL' &&
      node.arguments?.length === 2 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      isImportMetaUrl(node.arguments[1])
    ) {
      add(node.arguments[0], 'deferred');
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      add(node.argument.literal, 'type');
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return references;
};
