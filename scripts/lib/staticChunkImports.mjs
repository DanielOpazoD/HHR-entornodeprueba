const STATIC_RELATIVE_JS_IMPORT_PATTERN = /\b(?:from|import)\s*["'](\.[^"']+\.js)["']/g;
const DYNAMIC_RELATIVE_JS_IMPORT_PATTERN = /\bimport\s*\(\s*["'](\.[^"']+\.js)["']\s*\)/g;

/**
 * Extract unique static relative ES module `.js` import/re-export specifiers
 * (both `from "./chunk.js"` and bare side-effect `import "./chunk.js"`),
 * excluding dynamic `import("./chunk.js")` calls.
 */
export const extractStaticRelativeJsImports = content => [
  ...new Set([...content.matchAll(STATIC_RELATIVE_JS_IMPORT_PATTERN)].map(match => match[1])),
];

/**
 * Extract unique dynamic relative ES module `.js` import specifiers
 * (`import("./chunk.js")`).
 */
export const extractDynamicRelativeJsImports = content => [
  ...new Set([...content.matchAll(DYNAMIC_RELATIVE_JS_IMPORT_PATTERN)].map(match => match[1])),
];

/**
 * Extract sibling asset chunk filenames (without leading `./`) imported
 * statically and dynamically by a built chunk inside `dist/assets/`.
 */
export const extractAssetChunkImports = content => ({
  static: extractStaticRelativeJsImports(content)
    .filter(specifier => specifier.startsWith('./'))
    .map(specifier => specifier.slice(2)),
  dynamic: extractDynamicRelativeJsImports(content)
    .filter(specifier => specifier.startsWith('./'))
    .map(specifier => specifier.slice(2)),
});
