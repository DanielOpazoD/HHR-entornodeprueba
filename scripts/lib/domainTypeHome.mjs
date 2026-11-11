import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Domain types have one home: their module under src/types/domain. */
const DOMAIN_TYPE_HOMES = 'src/types/domain/';
/** Names no other module may declare or export: a narrower shape gets its own name. */
const DOMAIN_ROOT_NAMES = new Set(['PatientData', 'DailyRecord']);

const resolveModule = (file, specifier) => {
  const resolved = specifier.startsWith('@/')
    ? `src/${specifier.slice(2)}`
    : specifier.startsWith('.')
      ? path.posix.join(path.posix.dirname(file), specifier)
      : specifier;
  return resolved.replace(/\.tsx?$/, '');
};

const isExported = node => node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
const runtimeExports = new Map();
/** Names a home module exports as runtime values (enums, constants, functions, classes). */
const runtimeExportsOf = (root, home) => {
  const key = path.join(root, home);
  if (runtimeExports.has(key)) return runtimeExports.get(key);
  const names = new Set();
  const file = [`${key}.ts`, path.join(key, 'index.ts')].find(candidate =>
    fs.existsSync(candidate)
  );
  if (file) {
    const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
    for (const statement of ast.statements) {
      if (!isExported(statement)) continue;
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
        }
      } else if (
        (ts.isEnumDeclaration(statement) ||
          ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement)) &&
        statement.name
      ) {
        names.add(statement.name.text);
      }
    }
  }
  runtimeExports.set(key, names);
  return names;
};

/**
 * True when a module outside src/types rebuilds a facade over a domain type: it declares or
 * exports a root name, re-exports a type from its home, or aliases an imported domain type as
 * is. It does not depend on the `type` keyword: an unmarked import or re-export of a type is
 * the same facade. Derived shapes (Partial<X>, Pick<X, …>, X['field']) are not facades, and a
 * runtime value re-exported from its home is left to the module graph controls.
 */
export const isDomainTypeFacade = (file, source, root = process.cwd()) => {
  if (!file.startsWith('src/') || file.startsWith('src/types/')) return false;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const homeOf = specifier => {
    const resolved = specifier && resolveModule(file, specifier.text);
    return resolved?.startsWith(DOMAIN_TYPE_HOMES) ? resolved : undefined;
  };
  /** Local name → whether it is only a type in its home. */
  const imported = new Map();
  for (const statement of ast.statements) {
    const home = ts.isImportDeclaration(statement) && homeOf(statement.moduleSpecifier);
    if (!home) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const original = (element.propertyName ?? element.name).text;
        imported.set(
          element.name.text,
          statement.importClause.isTypeOnly ||
            element.isTypeOnly ||
            !runtimeExportsOf(root, home).has(original)
        );
      }
    } else if (bindings) {
      imported.set(bindings.name.text, true);
    }
  }
  const isImportedTypeAsIs = type =>
    ts.isTypeReferenceNode(type) &&
    !type.typeArguments?.length &&
    imported.has(type.typeName.getText(ast).split('.')[0]);
  return ast.statements.some(statement => {
    if (ts.isTypeAliasDeclaration(statement)) {
      return DOMAIN_ROOT_NAMES.has(statement.name.text) || isImportedTypeAsIs(statement.type);
    }
    if (ts.isInterfaceDeclaration(statement)) return DOMAIN_ROOT_NAMES.has(statement.name.text);
    if (!ts.isExportDeclaration(statement)) return false;
    const home = homeOf(statement.moduleSpecifier);
    const clause = statement.exportClause;
    if (!clause || !ts.isNamedExports(clause)) return Boolean(home);
    return clause.elements.some(element => {
      const original = (element.propertyName ?? element.name).text;
      if (DOMAIN_ROOT_NAMES.has(element.name.text) || DOMAIN_ROOT_NAMES.has(original)) return true;
      if (home) {
        return (
          statement.isTypeOnly || element.isTypeOnly || !runtimeExportsOf(root, home).has(original)
        );
      }
      return !statement.moduleSpecifier && imported.get(original) === true;
    });
  });
};
