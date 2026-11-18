/**
 * Listing and resolving the app's source modules, shared by the checks that read the import
 * graph. Paths are POSIX and relative to the repository root.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cts'];

export const toPosix = value => value.split(path.sep).join('/');

/** Code that ships: not a test, a story or an ambient type declaration. */
export const isProductionFile = relativePath =>
  !relativePath.startsWith('src/tests/') &&
  !/\.(?:test|spec|stories)\./.test(relativePath) &&
  !/\.d\.[cm]?ts$/.test(relativePath);

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

/** TypeScript sources Vite serves for a `.js`-style specifier, as `./x.js` → `./x.ts`. */
const TS_FOR_JS = [
  [/\.js$/, ['.ts', '.tsx']],
  [/\.jsx$/, ['.tsx']],
  [/\.mjs$/, ['.mts']],
  [/\.cjs$/, ['.cts']],
];

/**
 * The listed file a specifier points at, resolved as Vite does, or null for packages and files
 * outside the list: `@/` is `src/`, a leading `/` is the repository root (`/src/x.ts`), and
 * `./x.js` may be `./x.ts` (`.mjs` → `.mts`, `.cjs` → `.cts`). A specifier with a Vite query is
 * not a module import and resolves to null; `readClassifiedReferences` turns `?worker` into one.
 */
export const resolveSpecifier = (fromFile, bare, files) => {
  if (bare.includes('?')) return null;
  let base;
  if (bare.startsWith('@/')) base = `src/${bare.slice(2)}`;
  else if (bare.startsWith('.')) base = toPosix(path.join(path.dirname(fromFile), bare));
  else if (bare.startsWith('/')) base = toPosix(path.posix.normalize(bare.slice(1)));
  else return null;
  const candidates = [
    base,
    ...TS_FOR_JS.flatMap(([pattern, extensions]) =>
      pattern.test(base) ? extensions.map(extension => base.replace(pattern, extension)) : []
    ),
    ...SOURCE_EXTENSIONS.map(extension => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map(extension => `${base}/index${extension}`),
  ];
  return candidates.find(candidate => files.has(candidate)) ?? null;
};

/** Literal module references, including type-only imports and commented dynamic imports. */
export const readModuleReferences = source => ts.preProcessFile(source, true, true).importedFiles;

const WORKER_QUERY = /^(?:worker|sharedworker)(?:&|$)/;

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
 * - `deferred`: loaded later, by `import('x')`, by `new URL('x', import.meta.url)` (how Vite is
 *   told about a worker), or by `import W from 'x?worker'` (also `?sharedworker`).
 * Imports with `?raw`, `?url` or `?inline` bring a file as text or a URL, not as code, and are not
 * references. Comments, strings and non-literal specifiers are not references either.
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
  const add = (literal, kind) => {
    const [specifier, query] = literal.text.split('?');
    // `?raw`, `?url` and `?inline` bring a file as text or a URL: no code of it runs.
    if (query !== undefined && !WORKER_QUERY.test(query)) return;
    references.push({
      specifier,
      kind: query !== undefined && kind !== 'type' ? 'deferred' : kind,
      line: tree.getLineAndCharacterOfPosition(literal.getStart(tree)).line + 1,
    });
  };
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

const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);

const insideType = node => {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current)) return true;
    if (ts.isStatement(current) || ts.isSourceFile(current)) return false;
  }
  return false;
};

/** `x.name` or `x['name']`, as the accessed name, or null. */
const accessedName = node =>
  ts.isPropertyAccessExpression(node)
    ? node.name.text
    : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
      ? node.argumentExpression.text
      : null;

/**
 * Whether the source uses one of `globals` as the browser global, by syntax: the free identifier
 * (`indexedDB.open()`) or a member of `window`, `globalThis` or `self`
 * (`window.indexedDB`, `window['indexedDB']`). Property names, types and local bindings with the
 * same name are not the global.
 */
export const usesGlobal = (fileName, source, globals) => {
  if (!globals.some(name => source.includes(name))) return false;
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const localNames = new Set();
  const uses = [];
  const visit = node => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isImportSpecifier(node) ||
        ts.isImportClause(node) ||
        ts.isBindingElement(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      globals.includes(node.name.text)
    )
      localNames.add(node.name.text);
    const member = accessedName(node);
    if (
      member &&
      globals.includes(member) &&
      ts.isIdentifier(node.expression) &&
      GLOBAL_OBJECTS.has(node.expression.text)
    )
      uses.push({ name: member, free: false });
    if (
      ts.isIdentifier(node) &&
      globals.includes(node.text) &&
      node.parent?.name !== node && // a property, parameter, variable or member name
      !insideType(node)
    )
      uses.push({ name: node.text, free: true });
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return uses.some(use => !use.free || !localNames.has(use.name));
};
