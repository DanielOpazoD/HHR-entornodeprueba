#!/usr/bin/env node

/**
 * Data-layer reads must never turn failure into an empty result.
 * Optional browser capability probes with a complete fallback may mark each empty return with
 * `// empty-on-failure-allow optional-capability: <reason>` on the immediately preceding line.
 * This local exception is never for data reads. No inherited exceptions are accepted.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const AREAS = [
  'src/features/laboratory/services/labFirestoreService.ts',
  'src/services/repositories',
  'src/services/reminders',
  'src/services/storage/firestore',
  'src/services/storage/indexeddb',
  'src/services/storage/sync',
];
const EMPTY_RETURN = /\breturn\s+(?:\[\]|null|\{\}|new (?:Map|Set)\(\))\s*;/;
const DECLARATION = [
  /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>|<)/,
  /^\s*(?:(?:public|private|protected|static|async|override)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
  /^\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:\(|function\b)/,
];
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return']);

const toPosix = value => value.split(path.sep).join('/');

const walk = relativeDir => {
  const absoluteDir = path.join(ROOT, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  if (fs.statSync(absoluteDir).isFile()) return [relativeDir];
  const files = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = toPosix(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) files.push(...walk(relativePath));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name))
      files.push(relativePath);
  }
  return files;
};

const indentOf = line => line.match(/^\s*/)[0].length;

/** Name of the closest enclosing declaration, by indentation, above `lineIndex`. */
const enclosingName = (lines, lineIndex) => {
  let indent = indentOf(lines[lineIndex]);
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    // Blank lines, deeper lines and the closing lines of a multi-line signature are not parents.
    if (!line.trim() || indentOf(line) >= indent || /^[)\]}>]/.test(line.trim())) continue;
    indent = indentOf(line);
    for (const pattern of DECLARATION) {
      const name = line.match(pattern)?.[1];
      if (name && !KEYWORDS.has(name)) return name;
    }
  }
  return '(module)';
};

const findEntries = () => {
  const entries = [];
  for (const file of AREAS.flatMap(walk)) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const lines = source.split('\n');
    // Subscription error callbacks are reads too: emitting [] after onError masks failure.
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = node => {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 'onSnapshot') {
        // Firestore accepts options, next/error/complete callbacks, or an observer object.
        // A trailing completion callback and an omitted error callback are not read failures.
        const second = node.arguments[1];
        const isFunction = value =>
          value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value));
        const errorOf = observer =>
          ts.isObjectLiteralExpression(observer)
            ? observer.properties.find(property => property.name?.getText(tree) === 'error')
            : undefined;
        const isObserver = value =>
          value &&
          ts.isObjectLiteralExpression(value) &&
          value.properties.some(property =>
            ['next', 'error', 'complete'].includes(property.name?.getText(tree))
          );
        const nextIndex =
          second && ts.isObjectLiteralExpression(second) && !isObserver(second) ? 2 : 1;
        const next = node.arguments[nextIndex];
        const errorProperty = next && isObserver(next) ? errorOf(next) : undefined;
        const handler = errorProperty
          ? ts.isPropertyAssignment(errorProperty)
            ? errorProperty.initializer
            : errorProperty
          : isFunction(next)
            ? node.arguments[nextIndex + 1]
            : undefined;
        if (handler && (isFunction(handler) || ts.isMethodDeclaration(handler))) {
          const emitsEmpty = child => {
            if (
              ts.isCallExpression(child) &&
              child.arguments.length === 1 &&
              child.arguments.some(
                arg =>
                  (ts.isArrayLiteralExpression(arg) && arg.elements.length === 0) ||
                  arg.kind === ts.SyntaxKind.NullKeyword
              )
            ) {
              const lineIndex = source.slice(0, node.getStart(tree)).split('\n').length - 1;
              entries.push(`${file}::${enclosingName(lines, lineIndex)}`);
            }
            ts.forEachChild(child, emitsEmpty);
          };
          emitsEmpty(handler.body);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
    for (const match of source.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g)) {
      let depth = 1;
      let end = match.index + match[0].length;
      for (; end < source.length && depth > 0; end += 1) {
        if (source[end] === '{') depth += 1;
        else if (source[end] === '}') depth -= 1;
      }
      const body = source.slice(match.index + match[0].length, end - 1);
      const code = body.replace(/^[ \t]*\/\/ empty-on-failure-allow[^\r\n]*/gm, comment =>
        ' '.repeat(comment.length)
      );
      if (/\bthrow\b/.test(code)) continue;
      const unreasonedReturns = [...code.matchAll(new RegExp(EMPTY_RETURN.source, 'g'))].some(
        emptyReturn => {
          const precedingLines = body.slice(0, emptyReturn.index).split('\n');
          const returnLinePrefix = precedingLines.pop();
          const previousLine = precedingLines.pop() ?? '';
          return (
            !/^\s*$/.test(returnLinePrefix) ||
            !/^\s*\/\/ empty-on-failure-allow optional-capability: [^\S\r\n]*\S.*$/.test(
              previousLine
            )
          );
        }
      );
      if (!unreasonedReturns) continue;
      const lineIndex = source.slice(0, match.index).split('\n').length - 1;
      entries.push(`${file}::${enclosingName(lines, lineIndex)}`);
    }
  }
  return entries.sort();
};

const current = findEntries();
if (current.length === 0) {
  console.log('[empty-on-failure-reads] OK (no reads return empty on failure).');
  process.exit(0);
}
for (const key of new Set(current)) {
  console.error(
    `- new: ${key} returns empty on failure. Throw, or return a result the caller must handle. Only optional browser capabilities (Storage, BroadcastChannel, etc.), never data reads, may use an immediately preceding "// empty-on-failure-allow optional-capability: <reason>".`
  );
}
process.exit(1);
