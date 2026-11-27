import ts from 'typescript';
import { lineOf } from './astDetectors.mjs';

const DATE_FORMAT_OPTION_NAMES = new Set([
  'hour',
  'minute',
  'second',
  'day',
  'month',
  'year',
  'weekday',
  'dateStyle',
  'timeStyle',
  'era',
]);

const LOCALE_FORMAT_METHODS = new Set([
  'toLocaleDateString',
  'toLocaleTimeString',
  'toLocaleString',
]);

const LOCAL_CALENDAR_METHODS = new Set(['getFullYear', 'getMonth', 'getDate', 'setHours']);
const DEVICE_CLOCK_TIME_METHODS = new Set(['getHours', 'getMinutes', 'toTimeString']);
const SHIFT_START_TIME_TEXT = /^(?:0?[89]|20):00$/;
const SHIFT_START_HOURS = new Set(['8', '9', '20']);

const parseAst = (source, relativePath) =>
  ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    /x$/.test(relativePath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

const unwrapExpression = node => {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current;
};

const propertyNameText = name => {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return null;
};

const isNewDateExpression = node => {
  const expr = unwrapExpression(node);
  return (
    Boolean(expr) &&
    ts.isNewExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'Date'
  );
};

const isIntlDateTimeFormat = node => {
  const expr = unwrapExpression(node);
  if (!expr || !ts.isPropertyAccessExpression(expr) || expr.name.text !== 'DateTimeFormat') {
    return false;
  }
  const base = unwrapExpression(expr.expression);
  if (ts.isIdentifier(base) && base.text === 'Intl') return true;
  return (
    ts.isPropertyAccessExpression(base) &&
    base.name.text === 'Intl' &&
    ts.isIdentifier(base.expression) &&
    ['globalThis', 'window', 'self'].includes(base.expression.text)
  );
};

const objectLiteralHasProperty = (node, matcher) => {
  const expr = unwrapExpression(node);
  if (!expr || !ts.isObjectLiteralExpression(expr)) return false;
  return expr.properties.some(prop => {
    if (ts.isShorthandPropertyAssignment(prop)) return matcher(prop.name.text);
    if (ts.isPropertyAssignment(prop)) {
      const key = propertyNameText(prop.name);
      return key !== null && matcher(key);
    }
    return false;
  });
};

const expressionMentionsIdentifier = (node, targetName) => {
  if (!node) return false;
  let found = false;
  const walk = current => {
    if (found) return;
    if (ts.isIdentifier(current) && current.text === targetName) {
      found = true;
      return;
    }
    if (ts.isStringLiteralLike(current) && current.text === targetName) {
      found = true;
      return;
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return found;
};

const hasExplicitTimeZoneOption = optionsArg => {
  if (!optionsArg) return false;
  const expr = unwrapExpression(optionsArg);
  if (ts.isObjectLiteralExpression(expr)) {
    return objectLiteralHasProperty(expr, key => key === 'timeZone');
  }
  return expressionMentionsIdentifier(expr, 'timeZone');
};

/**
 * Finds `toLocaleDateString`, `toLocaleTimeString`, `toLocaleString` (on dates or with date
 * options) and `Intl.DateTimeFormat` calls that omit `timeZone`, using the TypeScript AST so
 * comments, strings and nested parentheses never confuse detection.
 */
export const zoneLessFormatLines = (source, relativePath = 'file.ts') => {
  if (!source.includes('toLocale') && !source.includes('DateTimeFormat')) return [];
  const tree = parseAst(source, relativePath);
  const lines = new Set();

  const visit = node => {
    if (
      (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
      isIntlDateTimeFormat(node.expression)
    ) {
      const optionsArg = node.arguments?.[1];
      if (!hasExplicitTimeZoneOption(optionsArg)) {
        lines.add(lineOf(source, node.getStart(tree)));
      }
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (LOCALE_FORMAT_METHODS.has(method)) {
        const optionsArg = node.arguments[1];
        if (!hasExplicitTimeZoneOption(optionsArg)) {
          const isDateLocaleString =
            method !== 'toLocaleString' ||
            isNewDateExpression(node.expression.expression) ||
            objectLiteralHasProperty(optionsArg, key => DATE_FORMAT_OPTION_NAMES.has(key));
          if (isDateLocaleString) {
            lines.add(lineOf(source, node.expression.name.getStart(tree)));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(tree);
  return [...lines];
};

const isScopeNode = node =>
  ts.isSourceFile(node) ||
  ts.isBlock(node) ||
  ts.isFunctionLike(node) ||
  ts.isForStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isCatchClause(node);

/**
 * Finds local calendar getters (`getFullYear`, `getMonth`, `getDate`) and `setHours` called on
 * `new Date()` or single-argument `new Date(instant)` — directly chained or through a lexically
 * bound variable — ignoring comments, strings, shadowed bindings and multi-arg calendar dates.
 */
export const localCalendarGetterLines =
  rule =>
  (source, relativePath = 'file.ts') => {
    if (!source.includes('new Date')) return [];
    const tree = parseAst(source, relativePath);
    const sourceLines = source.split('\n');
    const allowed = new RegExp(`^\\s*// clinical-clock-allow ${rule}:\\s*\\S.*$`);
    const lines = new Set();

    const scopes = new Map();
    const scopeOf = node => {
      for (let current = node.parent; current; current = current.parent) {
        if (isScopeNode(current)) return current;
      }
      return tree;
    };

    const recordBinding = (scope, name, info) => {
      if (!scopes.has(scope)) scopes.set(scope, new Map());
      scopes.get(scope).set(name, info);
    };

    const resolveBinding = (node, name) => {
      for (let scope = scopeOf(node); scope; scope = scope.parent && scopeOf(scope)) {
        const map = scopes.get(scope);
        if (map?.has(name)) return map.get(name);
      }
      return null;
    };

    const isSingleOrZeroArgNewDate = node => {
      const expr = unwrapExpression(node);
      return (
        Boolean(expr) &&
        ts.isNewExpression(expr) &&
        ts.isIdentifier(expr.expression) &&
        expr.expression.text === 'Date' &&
        (expr.arguments?.length ?? 0) <= 1
      );
    };

    const reportSite = siteNode => {
      const line = lineOf(source, siteNode.getStart(tree));
      if (!allowed.test(sourceLines[line - 2] ?? '')) {
        lines.add(line);
      }
    };

    // Pass 1: collect lexical variable/parameter bindings (shadowing non-Date bindings sets null).
    const collect = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const scope = scopeOf(node);
        const site = ts.isVariableDeclarationList(node.parent)
          ? ts.isVariableStatement(node.parent.parent)
            ? node.parent.parent
            : node.parent
          : node;
        if (node.initializer && isSingleOrZeroArgNewDate(node.initializer)) {
          recordBinding(scope, node.name.text, { site, isInstantDate: true });
        } else {
          recordBinding(scope, node.name.text, { site, isInstantDate: false });
        }
      } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
        recordBinding(scopeOf(node), node.name.text, { site: node, isInstantDate: false });
      }
      ts.forEachChild(node, collect);
    };
    collect(tree);

    // Pass 2: inspect local calendar method calls.
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const isZeroArgGetter =
          method !== 'setHours' &&
          LOCAL_CALENDAR_METHODS.has(method) &&
          node.arguments.length === 0;
        const isSetHours = method === 'setHours';
        if (isZeroArgGetter || isSetHours) {
          const receiver = unwrapExpression(node.expression.expression);
          if (isSingleOrZeroArgNewDate(receiver)) {
            const site =
              ts.isVariableDeclaration(node.parent) &&
              ts.isVariableDeclarationList(node.parent.parent) &&
              ts.isVariableStatement(node.parent.parent.parent)
                ? node.parent.parent.parent
                : receiver;
            reportSite(site);
          } else if (ts.isIdentifier(receiver)) {
            const binding = resolveBinding(receiver, receiver.text);
            if (binding?.isInstantDate) {
              reportSite(binding.site);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(tree);
    return [...lines];
  };

/**
 * Finds hardcoded shift start hours (`'08:00'`, `'9:00'`, `'20:00'`, or `8|9|20 * 60` minutes,
 * excluding duration products like `8 * 60 * 1000`) using the AST so comments do not match.
 */
export const shiftStartLiteralLines = (source, relativePath = 'file.ts') => {
  if (!/(?:0?[89]|20):00|(?:8|9|20)\s*\*\s*60/.test(source)) return [];
  const tree = parseAst(source, relativePath);
  const sourceLines = source.split('\n');
  const allowed = /^\s*\/\/ clinical-clock-allow shift-start-literal:\s*\S/;
  const lines = new Set();

  const report = node => {
    const line = lineOf(source, node.getStart(tree));
    if (!allowed.test(sourceLines[line - 2] ?? '')) {
      lines.add(line);
    }
  };

  const visit = node => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      SHIFT_START_TIME_TEXT.test(node.text)
    ) {
      report(node);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AsteriskToken &&
      ts.isNumericLiteral(node.left) &&
      ts.isNumericLiteral(node.right) &&
      SHIFT_START_HOURS.has(node.left.text) &&
      node.right.text === '60'
    ) {
      const parentIsMultiply =
        ts.isBinaryExpression(node.parent) &&
        node.parent.operatorToken.kind === ts.SyntaxKind.AsteriskToken;
      if (!parentIsMultiply) {
        report(node);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(tree);
  return [...lines];
};

/**
 * Finds device clock reads (`.getHours()`, `.getMinutes()`, `.toTimeString()`) via AST so
 * comments and string literals never produce false positives.
 */
export const deviceClockTimeLines = (source, relativePath = 'file.ts') => {
  if (!/getHours|getMinutes|toTimeString/.test(source)) return [];
  const tree = parseAst(source, relativePath);
  const lines = new Set();

  const visit = node => {
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 0 &&
      ts.isPropertyAccessExpression(node.expression) &&
      DEVICE_CLOCK_TIME_METHODS.has(node.expression.name.text)
    ) {
      lines.add(lineOf(source, node.expression.name.getStart(tree)));
    }
    ts.forEachChild(node, visit);
  };

  visit(tree);
  return [...lines];
};
