// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { countExplicitAny } from '../../../scripts/explicitAnySupport.mjs';

describe('countExplicitAny', () => {
  it('counts the any type wherever the syntax allows one', () => {
    expect(
      countExplicitAny(
        [
          'const a: any = 1;',
          'const b = a as any;',
          'const c: any[] = [];',
          'const d: Array<any> = [];',
          'function e(value: Record<string, any>) { return value; }',
        ].join('\n')
      )
    ).toBe(5);
  });

  it('ignores the word in comments, strings and names', () => {
    expect(
      countExplicitAny(
        [
          '// A passport is never read as a RUT: any letter disqualifies it.',
          '/** Returns: any value the caller stored. */',
          "const label = 'kind: any';",
          'const anyLetter = /\\p{L}/u;',
          'const many: number = 2;',
        ].join('\n')
      )
    ).toBe(0);
  });

  it('does not count an any that ESLint was told to accept, with the rule named', () => {
    expect(
      countExplicitAny(
        [
          '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
          'export function lazy<T extends ComponentType<any>>(load: T) {}',
          'const kept: any = 1; // eslint-disable-line @typescript-eslint/no-explicit-any',
          '// eslint-disable-next-line no-console',
          'const counted: any = 2;',
        ].join('\n')
      )
    ).toBe(1);
  });

  it('reads JSX files', () => {
    expect(countExplicitAny('const View = (props: any) => <p>any: text</p>;', 'View.tsx')).toBe(1);
  });
});
