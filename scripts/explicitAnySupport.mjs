import ts from 'typescript';

const RULE = '@typescript-eslint/no-explicit-any';

/** Lines on which a real ESLint directive comment accepts the rule, by its exact name. */
const acceptedLines = (source, content) => {
  const lines = new Set();
  const seen = new Set();
  const read = range => {
    if (seen.has(range.pos)) return;
    seen.add(range.pos);
    const raw = content.slice(range.pos, range.end);
    const text = (raw.startsWith('//') ? raw.slice(2) : raw.slice(2, -2)).trim();
    const directive = /^eslint-disable-(next-line|line)\s+([\s\S]*)$/.exec(text);
    if (!directive) return;
    const rules = (directive[2].split(/\s--\s/)[0] ?? '').split(',').map(rule => rule.trim());
    if (!rules.includes(RULE)) return;
    const line = source.getLineAndCharacterOfPosition(range.end).line;
    lines.add(directive[1] === 'next-line' ? line + 1 : line);
  };
  const visit = node => {
    (ts.getLeadingCommentRanges(content, node.getFullStart()) ?? []).forEach(read);
    (ts.getTrailingCommentRanges(content, node.getEnd()) ?? []).forEach(read);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
};

/**
 * Explicit `any` types in a TypeScript source, read from its syntax: the word in a comment, a
 * string or an identifier is not one. An `any` that an ESLint directive comment accepts on that
 * line, naming the rule exactly, is a recorded decision and is not counted. A file-wide disable,
 * a directive without the rule, or the same words inside a string accept nothing.
 */
export const countExplicitAny = (content, fileName = 'file.ts') => {
  // The word must appear for the type to appear: most files end here without being parsed.
  if (!/\bany\b/.test(content)) return 0;
  const source = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const found = [];
  const visit = node => {
    if (node.kind === ts.SyntaxKind.AnyKeyword)
      found.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line);
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!found.length || !content.includes('eslint-disable-')) return found.length;
  const accepted = acceptedLines(source, content);
  return found.filter(line => !accepted.has(line)).length;
};
