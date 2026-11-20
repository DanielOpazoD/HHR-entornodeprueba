/**
 * Figures every quality evaluation recomputed by hand (W20 evaluation, proposal 8), measured
 * from the repository so two evaluations of one commit agree. `report-quality-metrics` writes
 * them under `evaluation`. A figure whose source file is missing or unreadable is `null`
 * (not measured), never zero.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { listProductionSources, resolveSpecifier } from './sourceModules.mjs';

const readText = (root, relativePath) => {
  try {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
  } catch {
    return null;
  }
};

const readJson = (root, relativePath) => {
  const text = readText(root, relativePath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const isExported = node => (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
const isDefault = node => (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Default) !== 0;

/** Exports, imports (names asked for, or `*`) and re-exports of one module. */
const readModule = (file, source, files) => {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const exports = new Map(); // name → { isType, local }
  const imports = []; // { target, names: Set | '*' }
  const reexports = []; // { target, map: '*' | [exported, imported][] }
  const resolve = specifier => resolveSpecifier(file, specifier, files);

  for (const statement of tree.statements) {
    if (ts.isImportDeclaration(statement)) {
      const target = resolve(statement.moduleSpecifier.text);
      if (!target) continue;
      const clause = statement.importClause;
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        imports.push({ target, names: '*' });
        continue;
      }
      const names = new Set();
      if (clause?.name) names.add('default');
      for (const element of clause?.namedBindings?.elements ?? [])
        names.add((element.propertyName ?? element.name).text);
      imports.push({ target, names });
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const target = resolve(statement.moduleSpecifier.text);
      if (!target) continue;
      const clause = statement.exportClause;
      if (!clause) {
        reexports.push({ target, map: '*' });
      } else if (ts.isNamespaceExport(clause)) {
        exports.set(clause.name.text, { isType: false });
        reexports.push({ target, map: [[clause.name.text, '*']] });
      } else {
        const map = clause.elements.map(element => {
          const exported = element.name.text;
          exports.set(exported, { isType: statement.isTypeOnly || element.isTypeOnly });
          return [exported, (element.propertyName ?? element.name).text];
        });
        reexports.push({ target, map });
      }
    } else if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (!ts.isNamedExports(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements)
        exports.set(element.name.text, {
          isType: statement.isTypeOnly || element.isTypeOnly,
          local: (element.propertyName ?? element.name).text,
          listed: true,
        });
    } else if (ts.isExportAssignment(statement)) {
      exports.set('default', { isType: false });
    } else if (isExported(statement)) {
      if (isDefault(statement)) exports.set('default', { isType: false });
      else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations)
          if (ts.isIdentifier(declaration.name))
            exports.set(declaration.name.text, { isType: false, local: declaration.name.text });
      } else if (statement.name)
        exports.set(statement.name.text, {
          isType: ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement),
          local: statement.name.text,
        });
    }
  }

  const identifierCounts = new Map();
  const visit = node => {
    if (ts.isIdentifier(node))
      identifierCounts.set(node.text, (identifierCounts.get(node.text) ?? 0) + 1);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const target = resolve(node.arguments[0].text);
      if (target) imports.push({ target, names: '*' });
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      const target = resolve(node.argument.literal.text);
      const qualifier = node.qualifier;
      if (target)
        imports.push({
          target,
          names: qualifier
            ? new Set([ts.isIdentifier(qualifier) ? qualifier.text : qualifier.left.getText()])
            : '*',
        });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);

  // Uses of an exported binding inside its own file, without its declaration (and its listing).
  for (const entry of exports.values())
    if (entry.local)
      entry.localUses = (identifierCounts.get(entry.local) ?? 1) - 1 - (entry.listed ? 1 : 0);

  return { exports, imports, reexports, lineCount: source.split('\n').length };
};

/** Names of each module that production code asks for, following re-exports. */
const collectUsedExports = modules => {
  const used = new Map([...modules.keys()].map(file => [file, new Set()]));
  const mark = (file, name, seen) => {
    const key = `${file}#${name}`;
    const module = modules.get(file);
    if (seen.has(key) || !module) return;
    seen.add(key);
    if (name === '*') {
      for (const exported of module.exports.keys()) used.get(file).add(exported);
      for (const { target, map } of module.reexports)
        if (map === '*') mark(target, '*', seen);
        else for (const [, imported] of map) mark(target, imported, seen);
      return;
    }
    used.get(file).add(name);
    for (const { target, map } of module.reexports)
      if (map === '*') {
        if (!module.exports.has(name)) mark(target, name, seen);
      } else
        for (const [exported, imported] of map) if (exported === name) mark(target, imported, seen);
  };
  for (const module of modules.values())
    for (const { target, names } of module.imports)
      for (const name of names === '*' ? ['*'] : names) mark(target, name, new Set());
  return used;
};

const isBarrel = file => /^(?:index|public)\./.test(path.posix.basename(file));
/** A Netlify function's handler file: its exports are what Netlify calls. */
const isNetlifyHandler = file => file.startsWith('netlify/functions/') && !file.includes('/lib/');

/**
 * Production exports (src/ and netlify/functions/) that no production module imports, and
 * production modules of src/ that exactly one production module imports. Tests, stories and
 * scripts are not consumers.
 */
export const measureModuleGraph = root => {
  const files = [
    ...listProductionSources(root, 'src'),
    ...listProductionSources(root, 'netlify/functions'),
  ];
  const fileSet = new Set(files);
  const modules = new Map(
    files.map(file => [file, readModule(file, readText(root, file) ?? '', fileSet)])
  );

  const used = collectUsedExports(modules);
  const unused = { total: 0, types: 0, values: 0, valuesUsedInOwnFile: 0 };
  for (const [file, module] of modules) {
    if (isNetlifyHandler(file)) continue;
    for (const [name, entry] of module.exports) {
      if (used.get(file).has(name)) continue;
      unused.total += 1;
      if (entry.isType) unused.types += 1;
      else {
        unused.values += 1;
        if (entry.localUses > 0) unused.valuesUsedInOwnFile += 1;
      }
    }
  }

  const importers = new Map();
  for (const [file, module] of modules)
    for (const { target } of [...module.imports, ...module.reexports]) {
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(file);
    }
  const singleImporter = files.filter(
    file => file.startsWith('src/') && !isBarrel(file) && importers.get(file)?.size === 1
  );

  return {
    unusedProductionExports: unused,
    singleImporterModules: {
      count: singleImporter.length,
      upTo60Lines: singleImporter.filter(file => modules.get(file).lineCount <= 60).length,
    },
  };
};

/** npm scripts, in total and by the prefix before the first `:`. */
export const measureNpmScripts = root => {
  const scripts = readJson(root, 'package.json')?.scripts;
  if (!scripts || typeof scripts !== 'object') return null;
  const byPrefix = {};
  for (const name of Object.keys(scripts)) {
    const prefix = name.split(':')[0];
    byPrefix[prefix] = (byPrefix[prefix] ?? 0) + 1;
  }
  return {
    total: Object.keys(scripts).length,
    byPrefix: Object.fromEntries(Object.entries(byPrefix).sort(([a], [b]) => a.localeCompare(b))),
  };
};

const ENFORCED_BY = '_Lo impone:_';
const DOCS_MARK = '**[docs]**';

/**
 * Rules of AGENTS.md (list items with «_Lo impone:_»), how many name **[docs]** among what
 * enforces them, how many depend on it alone, and the file's size in bytes.
 */
export const measureAgentRules = root => {
  const text = readText(root, 'AGENTS.md');
  if (text === null) return null;
  // An item runs from its `- ` to the next item or blank line (continuation lines included).
  const items = text
    .split(/\n(?=- )/)
    .map(item => item.split(/\n\s*\n/)[0])
    .filter(item => item.includes(ENFORCED_BY));
  const enforcement = items.map(item => item.slice(item.indexOf(ENFORCED_BY) + ENFORCED_BY.length));
  return {
    rules: items.length,
    withDocs: enforcement.filter(text => text.includes(DOCS_MARK)).length,
    docsOnly: enforcement.filter(text => text.trim() === DOCS_MARK).length,
    bytes: Buffer.byteLength(text),
  };
};

/**
 * Entries of the exception books that only go down and that the report does not already
 * count (the folder book and the module-size allowlist have their own sections).
 */
export const measureExceptionBooks = root => {
  const castCeilings = readJson(root, 'scripts/config/unknown-cast-ceilings.json')?.files;
  const uncheckedIndex = readJson(root, 'scripts/config/unchecked-index-baseline.json')?.total;
  const sessionPending = readJson(root, 'scripts/config/session-raw-read-ledger.json')?.pending;
  const retained = readJson(root, 'scripts/config/unreachable-modules.json')?.retained;
  return {
    unknownCastCeilings:
      castCeilings && typeof castCeilings === 'object'
        ? Object.values(castCeilings).reduce(
            (sum, ceiling) => sum + (Number.isFinite(ceiling) ? ceiling : 0),
            0
          )
        : null,
    uncheckedIndexBaseline: typeof uncheckedIndex === 'number' ? uncheckedIndex : null,
    sessionRawReadPending:
      sessionPending && typeof sessionPending === 'object'
        ? Object.keys(sessionPending).length
        : null,
    unreachableRetainedFiles: Array.isArray(retained)
      ? retained.reduce((sum, entry) => sum + (entry.files?.length ?? 0), 0)
      : null,
  };
};
