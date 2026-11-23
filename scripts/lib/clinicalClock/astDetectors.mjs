import ts from 'typescript';

export const lineOf = (source, index) => source.slice(0, index).split('\n').length;

// Follow syntax and local aliases so assertions, fallbacks and arbitrary alias names cannot
// conceal an instant. Explicit UTC calendar arithmetic stays calendar; ambiguous fields need a local reason.
export const instantCalendarSliceLines = (source, relativePath) => {
  const tree = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  const scopes = new Map();
  const isScope = node => ts.isSourceFile(node) || ts.isBlock(node) || ts.isFunctionLike(node);
  const scopeOf = node => {
    for (let current = node.parent; current; current = current.parent) {
      if (isScope(current)) return current;
    }
    return tree;
  };
  const collect = node => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
      const scope = scopeOf(node);
      if (!scopes.has(scope)) scopes.set(scope, new Map());
      scopes.get(scope).set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  collect(tree);

  const initializerOf = node => {
    for (let scope = scopeOf(node); scope; scope = scope.parent && scopeOf(scope)) {
      if (scopes.get(scope)?.has(node.text)) return scopes.get(scope).get(node.text);
    }
  };
  const isCalendar = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return false;
    seen.add(node);
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAsExpression(node)
    ) {
      return isCalendar(node.expression, seen);
    }
    if (ts.isIdentifier(node)) return isCalendar(initializerOf(node), seen);
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      return /T(?:00|12):00:00(?:\.000)?Z$/.test(
        ts.isStringLiteralLike(node) ? node.text : (node.templateSpans.at(-1)?.literal.text ?? '')
      );
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Date'
    ) {
      return node.arguments?.length === 1 && isCalendar(node.arguments[0], seen);
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression))
        return ['parseCalendarDateUtcNoon', 'calendarDayAtUtcNoon'].includes(node.expression.text);
      if (ts.isPropertyAccessExpression(node.expression)) {
        const { expression, name } = node.expression;
        if (ts.isIdentifier(expression) && expression.text === 'Date') {
          return (
            (name.text === 'UTC' &&
              node.arguments.length >= 3 &&
              node.arguments
                .slice(3)
                .every(
                  (arg, index) =>
                    arg.getText(tree) === '0' || (index === 0 && arg.getText(tree) === '12')
                )) ||
            (name.text === 'parse' && isCalendar(node.arguments[0], seen))
          );
        }
        if (name.text === 'getTime') return isCalendar(expression, seen);
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operatorToken.kind)
    ) {
      return isCalendar(node.left, seen) || isCalendar(node.right, seen);
    }
    return false;
  };

  const instantName = /(?:At|[tT]imestamp|lastUpdated|isoNow)$/;
  const isInstant = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return false;
    seen.add(node);
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      return isInstant(node.expression, seen);
    }
    if (ts.isIdentifier(node)) {
      if (instantName.test(node.text)) return true;
      return isInstant(initializerOf(node), seen);
    }
    if (ts.isPropertyAccessExpression(node)) return instantName.test(node.name.text);
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) {
      return instantName.test(node.argumentExpression.text);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      return (
        ['toISOString', 'toJSON'].includes(node.expression.name.text) &&
        !isCalendar(node.expression.expression)
      );
    }
    if (ts.isBinaryExpression(node))
      return isInstant(node.left, seen) || isInstant(node.right, seen);
    if (ts.isConditionalExpression(node))
      return isInstant(node.whenTrue, seen) || isInstant(node.whenFalse, seen);
    return false;
  };

  const lines = new Set();
  const sourceLines = source.split('\n');
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { name, expression: receiver } = node.expression;
      const args = node.arguments;
      const isSlice =
        ['slice', 'substring', 'substr'].includes(name.text) &&
        args.length === 2 &&
        args[0].getText(tree) === '0' &&
        args[1].getText(tree) === '10';
      const isSplit =
        name.text === 'split' &&
        args.length === 1 &&
        ts.isStringLiteral(args[0]) &&
        args[0].text === 'T' &&
        ts.isElementAccessExpression(node.parent) &&
        node.parent.argumentExpression.getText(tree) === '0';
      if ((isSlice || isSplit) && isInstant(receiver)) {
        const line = lineOf(source, node.expression.name.getStart(tree));
        if (
          !/^\s*\/\/ clinical-clock-allow instant-calendar-slice:\s*\S.*$/.test(
            sourceLines[line - 2] ?? ''
          )
        ) {
          lines.add(line);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return [...lines];
};

const DEVICE_WALL_CLOCK = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const INSTANT_OPERATORS = new Set(
  ['Minus', 'Plus', 'LessThan', 'LessThanEquals', 'GreaterThan', 'GreaterThanEquals'].map(
    name => ts.SyntaxKind[`${name}Token`]
  )
);

// A zone-less wall-clock time read as an instant: an operand of arithmetic or a comparison,
// directly, through `.getTime()`/`.valueOf()` or through a local. Reading it back with local
// getters is calendar.
export const deviceWallClockInstantLines = (source, relativePath) => {
  const tree = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  const initializers = new Map();
  const lines = new Set();
  // The text a string ends with: a literal, the tail of a template or of a concatenation.
  const endText = node =>
    ts.isStringLiteralLike(node)
      ? node.text
      : ts.isTemplateExpression(node)
        ? node.templateSpans.at(-1).literal.text
        : ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
          ? endText(node.right)
          : '';
  const readsDeviceWallClock = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return false;
    seen.add(node);
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node)
    )
      return readsDeviceWallClock(node.expression, seen);
    if (ts.isIdentifier(node)) return readsDeviceWallClock(initializers.get(node.text), seen);
    const callee = node.expression?.getText(tree);
    if (
      (ts.isNewExpression(node) && callee === 'Date') ||
      (ts.isCallExpression(node) && callee === 'Date.parse')
    ) {
      return node.arguments?.length === 1 && DEVICE_WALL_CLOCK.test(endText(node.arguments[0]));
    }
    return (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['getTime', 'valueOf'].includes(node.expression.name.text) &&
      readsDeviceWallClock(node.expression.expression, seen)
    );
  };
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
      initializers.set(node.name.text, node.initializer);
    if (
      ts.isBinaryExpression(node) &&
      INSTANT_OPERATORS.has(node.operatorToken.kind) &&
      (readsDeviceWallClock(node.left) || readsDeviceWallClock(node.right))
    )
      lines.add(lineOf(source, node.getStart(tree)));
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return [...lines];
};

// Raw ISO clock extraction can preserve a mainland offset's digits instead of converting them.
// This bounded syntax check does not infer external timestamp contracts: local reports need a reason.
export const rawOffsetClockLines = (source, relativePath) => {
  const tree = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  const lines = new Set();
  const sourceLines = source.split('\n');
  // Bind this file only: the compiler handles lexical shadowing, loops and destructuring.
  // No dependencies or lib files are read, and only immutable simple bindings are trusted.
  const host = {
    getSourceFile: file => (file === relativePath ? tree : undefined),
    getDefaultLibFileName: () => '',
    writeFile() {},
    getCurrentDirectory: () => '',
    getDirectories: () => [],
    fileExists: file => file === relativePath,
    readFile: () => source,
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: file => file,
    getNewLine: () => '\n',
  };
  const checker = ts
    .createProgram(
      [relativePath],
      {
        noResolve: true,
        noLib: true,
        allowJs: true,
      },
      host
    )
    .getTypeChecker();
  const converted = (node, seen = new Set()) => {
    if (!node || seen.has(node)) return false;
    seen.add(node);
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isTypeAssertionExpression(node)
    )
      return converted(node.expression, seen);
    if (ts.isIdentifier(node)) {
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (node.text === 'undefined' && !declaration) return true;
      return Boolean(
        declaration &&
        ts.isVariableDeclaration(declaration) &&
        ts.isIdentifier(declaration.name) &&
        ts.isVariableDeclarationList(declaration.parent) &&
        (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
        converted(declaration.initializer, seen)
      );
    }
    if (
      node.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isStringLiteralLike(node) && node.text === '')
    )
      return true;
    if (ts.isConditionalExpression(node))
      return converted(node.whenTrue, new Set(seen)) && converted(node.whenFalse, new Set(seen));
    if (ts.isCallExpression(node)) {
      if (
        ts.isIdentifier(node.expression) &&
        [
          'encounterWallClockInRapaNui',
          'absoluteInstantInRapaNui',
          'buildSortableLocalTimestamp',
        ].includes(node.expression.text)
      )
        return true;
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'format'
      ) {
        const formatter = node.expression.expression;
        if (
          !ts.isNewExpression(formatter) ||
          formatter.expression.getText(tree) !== 'Intl.DateTimeFormat'
        )
          return false;
        const options = formatter.arguments?.[1];
        if (!options || !ts.isObjectLiteralExpression(options)) return false;
        // The last explicit timezone must win; a later spread/computed key may override it.
        for (const property of [...options.properties].reverse()) {
          if (
            ts.isSpreadAssignment(property) ||
            (property.name && ts.isComputedPropertyName(property.name))
          )
            return false;
          const name = property.name;
          if (
            name &&
            (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) &&
            name.text === 'timeZone'
          ) {
            if (!ts.isPropertyAssignment(property)) return false;
            const zone = property.initializer;
            return (
              (ts.isStringLiteralLike(zone) && zone.text === 'Pacific/Easter') ||
              (ts.isIdentifier(zone) && zone.text === 'CLINICAL_TIME_ZONE')
            );
          }
        }
        return false;
      }
    }
    return false;
  };
  const report = node => {
    const site = ts.isVariableDeclaration(node.parent) ? node.parent : node;
    const line = lineOf(source, site.getStart(tree));
    if (
      !/^\s*\/\/ clinical-clock-allow raw-offset-clock:\s*\S.*$/.test(sourceLines[line - 2] ?? '')
    )
      lines.add(line);
  };
  const visit = node => {
    if (ts.isRegularExpressionLiteral(node)) {
      const literal = node.text;
      // ISO/ISO-like time captures, not DMY report parsing or unrelated regular expressions.
      const call = ts.isPropertyAccessExpression(node.parent) ? node.parent.parent : node.parent;
      const extracts =
        ts.isCallExpression(call) &&
        ts.isPropertyAccessExpression(call.expression) &&
        ['match', 'exec'].includes(call.expression.name.text);
      if (extracts && literal.includes('T') && /\\d\{(?:1,2|2)\}.*:.*\\d\{2\}/.test(literal)) {
        const slash = literal.lastIndexOf('/');
        const regex = new RegExp(
          literal.slice(1, slash),
          literal.slice(slash + 1).replace(/[gy]/g, '')
        );
        const acceptsOffset = ['T', ' '].some(separator =>
          ['Z', '-03:00', '+03:00', '-0300', '+0300'].some(offset =>
            ['03:04', '03:04:05', '03:04:05.123'].some(clock =>
              regex.test(`2026-11-01${separator}${clock}${offset}`)
            )
          )
        );
        const input =
          call.expression.name.text === 'match' ? call.expression.expression : call.arguments[0];
        if (acceptsOffset && !converted(input)) report(call);
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { name, expression: receiver } = node.expression;
      const args = node.arguments;
      const cut =
        ['slice', 'substring', 'substr'].includes(name.text) && args[0]?.getText(tree) === '11';
      const split =
        name.text === 'split' &&
        args[0] &&
        ts.isStringLiteral(args[0]) &&
        args[0].text === 'T' &&
        ts.isElementAccessExpression(node.parent) &&
        node.parent.argumentExpression.getText(tree) === '1';
      if ((cut || split) && !converted(receiver)) report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return [...lines];
};
