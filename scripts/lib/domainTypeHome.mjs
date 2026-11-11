import path from 'node:path';
import ts from 'typescript';

/** Domain types whose only home is their module under src/types/domain. */
const DOMAIN_TYPE_HOMES = new Set(['src/types/domain/patient']);
/** Names no other module may declare or export: a narrower shape gets its own name. */
const DOMAIN_ROOT_NAMES = new Set(['PatientData']);

const resolveModule = (file, specifier) => {
  const resolved = specifier.startsWith('@/')
    ? `src/${specifier.slice(2)}`
    : specifier.startsWith('.')
      ? path.posix.join(path.posix.dirname(file), specifier)
      : specifier;
  return resolved.replace(/\.tsx?$/, '');
};

/**
 * True when a module outside src/types rebuilds a facade over a domain type: it declares or
 * exports a root name, re-exports from the home, or aliases an imported domain type as is.
 * Derived shapes (Partial<X>, Pick<X, …>, X['field']) are not facades.
 */
export const isDomainTypeFacade = (file, source) => {
  if (!file.startsWith('src/') || file.startsWith('src/types/')) return false;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const isHome = specifier =>
    specifier !== undefined && DOMAIN_TYPE_HOMES.has(resolveModule(file, specifier.text));
  const imported = new Set();
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement) || !isHome(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) imported.add(element.name.text);
    } else if (bindings) {
      imported.add(bindings.name.text);
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
    if (isHome(statement.moduleSpecifier)) return true;
    const clause = statement.exportClause;
    if (!clause || !ts.isNamedExports(clause)) return false;
    return clause.elements.some(element => {
      const original = (element.propertyName ?? element.name).text;
      return (
        DOMAIN_ROOT_NAMES.has(element.name.text) ||
        DOMAIN_ROOT_NAMES.has(original) ||
        (!statement.moduleSpecifier && imported.has(original))
      );
    });
  });
};
