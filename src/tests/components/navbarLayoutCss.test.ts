import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (relativePath: string): string => {
  const absolutePath = path.resolve(__dirname, '../../../', relativePath);
  return fs.readFileSync(absolutePath, 'utf8');
};

describe('navbar layout CSS contracts', () => {
  it('reserves the vertical scrollbar gutter from the first authenticated paint', () => {
    const css = readProjectFile('src/index.css');
    const htmlRule = css.match(/html\s*\{([\s\S]*?)\n\s*\}/m)?.[1] ?? '';

    expect(htmlRule).toContain('scrollbar-gutter: stable;');
    expect(htmlRule).toContain('overflow-y: scroll;');
  });
});
