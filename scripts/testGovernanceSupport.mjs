import ts from 'typescript';

const testRoots = new Set(['it', 'test', 'describe']);
// Keep the existing name-based policy; inspect syntax rather than fixture text.
// This is not symbol resolution: renamed imports and dynamic keys need review.
export const findTestModifiers = (relative, content) => {
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
