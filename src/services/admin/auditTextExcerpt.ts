/**
 * Long texts (handoff notes) are cut around the part that changed, so a before/after that only
 * differs near the end still shows the difference. `…` marks the parts left out.
 */
const CONTEXT = 60;

const commonPrefixLength = (a: string, b: string): number => {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index] === b[index]) index += 1;
  return index;
};

const slice = (text: string, from: number, length: number): string => {
  const body = text.slice(from, from + length);
  return `${from > 0 ? '…' : ''}${body}${from + body.length < text.length ? '…' : ''}`;
};

/**
 * Both sides keep at most `length` chars from the same offset, a little before their first
 * difference, so the excerpts stay aligned and can be compared again.
 */
export const excerptAroundChange = (
  before: string,
  after: string,
  length: number
): { before: string; after: string } => {
  if (before.length <= length && after.length <= length) return { before, after };
  const start = Math.max(0, commonPrefixLength(before, after) - CONTEXT);
  const from = Math.min(start, Math.max(0, Math.max(before.length, after.length) - length));
  return { before: slice(before, from, length), after: slice(after, from, length) };
};

export const truncateText = (text: string, length: number): string =>
  text.length > length ? `${text.slice(0, length)}…` : text;
