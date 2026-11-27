import ts from 'typescript';

const RELATIVE_JS_SPECIFIER = /^\.[^"']+\.js$/;

const collectRelativeJsImports = content => {
  const staticImports = new Set();
  const dynamicImports = new Set();
  const tree = ts.createSourceFile(
    'chunk.js',
    content,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS
  );

  const visit = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (RELATIVE_JS_SPECIFIER.test(node.moduleSpecifier.text)) {
        staticImports.add(node.moduleSpecifier.text);
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (RELATIVE_JS_SPECIFIER.test(node.moduleSpecifier.text)) {
        staticImports.add(node.moduleSpecifier.text);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      if (RELATIVE_JS_SPECIFIER.test(node.arguments[0].text)) {
        dynamicImports.add(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(tree);
  return {
    static: [...staticImports],
    dynamic: [...dynamicImports],
  };
};

/**
 * Extract unique static relative ES module `.js` import/re-export specifiers
 * (both `from "./chunk.js"` and bare side-effect `import "./chunk.js"`),
 * excluding dynamic `import("./chunk.js")` calls and ignoring comments/strings.
 */
export const extractStaticRelativeJsImports = content => collectRelativeJsImports(content).static;

/**
 * Extract unique dynamic relative ES module `.js` import specifiers
 * (`import("./chunk.js")`), ignoring comments and string literals.
 */
export const extractDynamicRelativeJsImports = content => collectRelativeJsImports(content).dynamic;

/**
 * Extract sibling asset chunk filenames (without leading `./`) imported
 * statically and dynamically by a built chunk inside `dist/assets/`.
 */
export const extractAssetChunkImports = content => {
  const imports = collectRelativeJsImports(content);
  return {
    static: imports.static
      .filter(specifier => specifier.startsWith('./'))
      .map(specifier => specifier.slice(2)),
    dynamic: imports.dynamic
      .filter(specifier => specifier.startsWith('./'))
      .map(specifier => specifier.slice(2)),
  };
};
