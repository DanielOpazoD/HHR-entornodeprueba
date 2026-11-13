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

  it.each([
    [
      'the directive words inside a string on the previous line',
      [
        'export const text = "eslint-disable-next-line @typescript-eslint/no-explicit-any";',
        'export type Value = any;',
      ],
    ],
    [
      'the directive words inside a string on the same line',
      [
        'export const pair: [string, any] = ["eslint-disable-line @typescript-eslint/no-explicit-any", 1];',
      ],
    ],
    [
      'a comment that only mentions the directive',
      [
        '// We avoid eslint-disable-next-line @typescript-eslint/no-explicit-any in this module.',
        'export type Value = any;',
      ],
    ],
    [
      'a directive that names another rule with the same beginning',
      [
        '// eslint-disable-next-line @typescript-eslint/no-explicit-anything',
        'export type Value = any;',
      ],
    ],
    ['a directive without any rule', ['// eslint-disable-next-line', 'export type Value = any;']],
    [
      'a file-wide disable',
      ['/* eslint-disable @typescript-eslint/no-explicit-any */', 'export type Value = any;'],
    ],
  ])('still counts an any next to %s', (_case, lines) => {
    expect(countExplicitAny(lines.join('\n'))).toBe(1);
  });

  it('accepts the directive among other rules, with a reason, in a block comment or mid-statement', () => {
    expect(
      countExplicitAny(
        [
          '// eslint-disable-next-line no-console, @typescript-eslint/no-explicit-any -- props are erased by unknown',
          'export type A = any;',
          '/* eslint-disable-next-line @typescript-eslint/no-explicit-any */',
          'export type B = any;',
          'export const c = call(',
          '  // eslint-disable-next-line @typescript-eslint/no-explicit-any',
          '  value as any',
          ');',
        ].join('\n')
      )
    ).toBe(0);
  });

  it('reads JSX files', () => {
    expect(countExplicitAny('const View = (props: any) => <p>any: text</p>;', 'View.tsx')).toBe(1);
  });
});
