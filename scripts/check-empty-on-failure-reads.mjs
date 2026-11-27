#!/usr/bin/env node

/**
 * Data-layer reads must never turn failure into an empty result.
 * Optional browser capability probes with a complete fallback may mark each empty return with
 * `// empty-on-failure-allow optional-capability: <reason>` on the immediately preceding line.
 * This local exception is never for data reads. No inherited exceptions are accepted.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const AREAS = [
  'src/features/census/services',
  'src/features/clinical-documents/services/ClinicalAttachmentRepository.ts',
  'src/features/handoff/services',
  'src/features/laboratory/services/labFirestoreService.ts',
  'src/features/prescriptions/services/PrescriptionRepository.ts',
  'src/features/radiology/services/mmradService.ts',
  'src/features/rayen-import/services',
  'src/features/wound-care/services',
  'src/services/admin/healthService.ts',
  'src/services/backup/censusStorageService.ts',
  'src/services/backup/cudyrStorageService.ts',
  'src/services/cudyr',
  'src/services/email/emailRecipientListService.ts',
  'src/services/laboratory',
  'src/services/patient',
  'src/services/reminders',
  'src/services/repositories',
  'src/services/storage/firestore',
  'src/services/storage/indexeddb',
  'src/services/storage/sync',
  'src/services/user-profile/userAvatarProfileService.ts',
  'src/services/user-profile/userSignatureService.ts',
];
const ALLOW_COMMENT = /^\s*\/\/ empty-on-failure-allow optional-capability: [^\S\r\n]*\S.*$/;

const toPosix = value => value.split(path.sep).join('/');

const walk = (root, relativeDir) => {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  if (fs.statSync(absoluteDir).isFile()) return [relativeDir];
  const files = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = toPosix(path.join(relativeDir, entry.name));
    if (entry.isDirectory()) files.push(...walk(root, relativePath));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name))
      files.push(relativePath);
  }
  return files;
};

const readPropertyName = name => {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
};

const isFunctionLike = node =>
  Boolean(node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)));

const unwrapExpression = node => {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
};

/** Name of the closest enclosing named declaration via AST parent traversal. */
const enclosingDeclarationName = node => {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return current.name.text;
    }
    if (
      (ts.isMethodDeclaration(current) ||
        ts.isGetAccessorDeclaration(current) ||
        ts.isSetAccessorDeclaration(current)) &&
      current.name
    ) {
      const name = readPropertyName(current.name);
      if (name) return name;
    }
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      isFunctionLike(unwrapExpression(current.initializer))
    ) {
      return current.name.text;
    }
    if (ts.isPropertyAssignment(current) && isFunctionLike(unwrapExpression(current.initializer))) {
      const name = readPropertyName(current.name);
      if (name) return name;
    }
    if (ts.isFunctionExpression(current) && current.name) {
      return current.name.text;
    }
    current = current.parent;
  }
  return '(module)';
};

const isEmptyReturnExpression = node => {
  const expr = unwrapExpression(node);
  if (!expr) return false;
  if (expr.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isArrayLiteralExpression(expr) && expr.elements.length === 0) return true;
  if (ts.isObjectLiteralExpression(expr) && expr.properties.length === 0) return true;
  if (
    ts.isNewExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    (expr.expression.text === 'Map' || expr.expression.text === 'Set') &&
    (!expr.arguments || expr.arguments.length === 0)
  ) {
    return true;
  }
  return false;
};

const hasAdjacentAllowComment = (returnNode, tree, lines) => {
  const { line, character } = tree.getLineAndCharacterOfPosition(returnNode.getStart(tree));
  const prefix = (lines[line] ?? '').slice(0, character);
  const previousLine = line > 0 ? (lines[line - 1] ?? '') : '';
  return /^\s*$/.test(prefix) && ALLOW_COMMENT.test(previousLine);
};

const inspectCatchBlock = (block, tree, lines) => {
  let hasThrow = false;
  let hasUnreasonedEmptyReturn = false;

  const visitStatement = node => {
    if (hasThrow) return;
    if (ts.isThrowStatement(node)) {
      hasThrow = true;
      return;
    }
    if (
      ts.isReturnStatement(node) &&
      isEmptyReturnExpression(node.expression) &&
      !hasAdjacentAllowComment(node, tree, lines)
    ) {
      hasUnreasonedEmptyReturn = true;
    }
    // Nested functions/classes and inner catches own their own control flow.
    if (ts.isFunctionLike(node) || ts.isClassLike(node) || ts.isCatchClause(node)) {
      return;
    }
    ts.forEachChild(node, visitStatement);
  };

  for (const statement of block.statements) visitStatement(statement);
  return !hasThrow && hasUnreasonedEmptyReturn;
};

const findEntries = root => {
  const entries = [];
  for (const file of AREAS.flatMap(area => walk(root, area))) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const lines = source.split('\n');
    // Subscription error callbacks and catch blocks are reads too: turning failure into an empty
    // result masks failure. Both are walked on the same TypeScript AST so comments and strings
    // can never confuse brace boundaries or throw/return checks.
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = node => {
      if (ts.isCallExpression(node) && node.expression.getText(tree) === 'onSnapshot') {
        // Firestore accepts options, next/error/complete callbacks, or an observer object.
        // A trailing completion callback and an omitted error callback are not read failures.
        const second = node.arguments[1];
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
          : isFunctionLike(next)
            ? node.arguments[nextIndex + 1]
            : undefined;
        if (handler && (isFunctionLike(handler) || ts.isMethodDeclaration(handler))) {
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
              entries.push(`${file}::${enclosingDeclarationName(node)}`);
            }
            ts.forEachChild(child, emitsEmpty);
          };
          emitsEmpty(handler.body);
        }
      } else if (ts.isCatchClause(node)) {
        if (inspectCatchBlock(node.block, tree, lines)) {
          entries.push(`${file}::${enclosingDeclarationName(node)}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return entries.sort();
};

/** Checks the data-layer reads in the repository at `root`, as the command prints and exits. */
export const checkEmptyOnFailureReads = (root = process.cwd()) => {
  const current = findEntries(root);
  if (current.length === 0) {
    return {
      status: 0,
      stdout: '[empty-on-failure-reads] OK (no reads return empty on failure).\n',
      stderr: '',
    };
  }
  const lines = [...new Set(current)].map(
    key =>
      `- new: ${key} returns empty on failure. Throw, or return a result the caller must handle. Only optional browser capabilities (Storage, BroadcastChannel, etc.), never data reads, may use an immediately preceding "// empty-on-failure-allow optional-capability: <reason>".`
  );
  return { status: 1, stdout: '', stderr: `${lines.join('\n')}\n` };
};

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const { status, stdout, stderr } = checkEmptyOnFailureReads();
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exitCode = status;
}
