import ts from 'typescript';

const RULE = '@typescript-eslint/no-explicit-any';

/**
 * Explicit `any` types in a TypeScript source, read from its syntax: the word in a comment, a
 * string or an identifier is not one. An `any` that ESLint was told to accept on that line, with
 * the rule named, is a recorded decision and is not counted.
 */
export const countExplicitAny = (content, fileName = 'file.ts') => {
  const source = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const lines = content.split('\n');
  const accepted = line =>
    (lines[line] ?? '').includes(`eslint-disable-line ${RULE}`) ||
    (lines[line - 1] ?? '').includes(`eslint-disable-next-line ${RULE}`);
  let count = 0;
  const visit = node => {
    if (
      node.kind === ts.SyntaxKind.AnyKeyword &&
      !accepted(source.getLineAndCharacterOfPosition(node.getStart(source)).line)
    )
      count += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
};
