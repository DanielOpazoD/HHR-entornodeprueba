#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const projectRoot = process.cwd();
const testsRoot = path.join(projectRoot, 'src', 'tests');
const allowlistPath = path.join(projectRoot, 'scripts', 'test-governance-allowlist.json');

const allowedSkipFiles = new Set(['src/tests/security/firestore-rules.test.ts']);
const testFilePattern = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const testRoots = new Set(['it', 'test', 'describe']);
// Keep the existing name-based policy; inspect syntax rather than fixture text.
// This is not symbol resolution: renamed imports and dynamic keys need review.
const findTestModifiers = (relative, content) => {
  if (!/\b(?:only|skip)\b/.test(content)) return [];
  const source = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true);
  const chain = expression => {
    if (ts.isIdentifier(expression)) return [{ name: expression.text, node: expression }];
    if (ts.isPropertyAccessExpression(expression)) {
      const prefix = chain(expression.expression);
      return prefix.length
        ? [...prefix, { name: expression.name.text, node: expression.name }]
        : [];
    }
    if (
      ts.isElementAccessExpression(expression) &&
      ts.isStringLiteral(expression.argumentExpression)
    ) {
      const prefix = chain(expression.expression);
      return prefix.length
        ? [
            ...prefix,
            { name: expression.argumentExpression.text, node: expression.argumentExpression },
          ]
        : [];
    }
    if (ts.isCallExpression(expression)) return chain(expression.expression);
    if (ts.isTaggedTemplateExpression(expression)) return chain(expression.tag);
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isNonNullExpression(expression)
    ) {
      return chain(expression.expression);
    }
    return [];
  };
  const found = new Map();
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const members = chain(node.expression);
      const rootIndex = members.findIndex(member => testRoots.has(member.name));
      if (rootIndex !== -1) {
        for (const modifier of members.slice(rootIndex + 1)) {
          if (modifier.name !== 'skip' && modifier.name !== 'only') continue;
          const position = modifier.node.getStart(source);
          found.set(`${modifier.name}:${position}`, {
            rule: modifier.name,
            line: source.getLineAndCharacterOfPosition(position).line + 1,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...found.values()];
};
const MEGATEST_LINE_LIMIT = 500;

const loadMegatestAllowlist = () => {
  if (!fs.existsSync(allowlistPath)) {
    return new Set();
  }

  const parsed = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
  return new Set(Array.isArray(parsed.megatests) ? parsed.megatests : []);
};

const allowedMegatestFiles = loadMegatestAllowlist();

const violations = [];

const toPosixRelative = filePath => path.relative(projectRoot, filePath).split(path.sep).join('/');

const walk = dir => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!testFilePattern.test(entry.name)) {
      continue;
    }

    const relative = toPosixRelative(fullPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const lineCount = content.length === 0 ? 0 : content.split('\n').length;

    if (lineCount > MEGATEST_LINE_LIMIT && !allowedMegatestFiles.has(relative)) {
      violations.push({
        relative,
        line: 1,
        rule: 'megatest',
        source: `${lineCount} lines (limit ${MEGATEST_LINE_LIMIT})`,
      });
    }

    const lines = content.split('\n');
    for (const modifier of findTestModifiers(relative, content)) {
      if (modifier.rule === 'skip' && allowedSkipFiles.has(relative)) continue;
      violations.push({ relative, ...modifier, source: lines[modifier.line - 1].trim() });
    }
  }
};

if (!fs.existsSync(testsRoot)) {
  console.log('[test-governance] src/tests not found, skipping check.');
  process.exit(0);
}

walk(testsRoot);

if (violations.length > 0) {
  console.error('[test-governance] Found forbidden test governance violations:');
  for (const violation of violations) {
    console.error(
      `- ${violation.relative}:${violation.line} [${violation.rule}] ${violation.source}`
    );
  }
  process.exit(1);
}

console.log('[test-governance] OK (no forbidden skip/only markers)');
