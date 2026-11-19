import { describe, expect, it } from 'vitest';
import { stableStringify } from '@/features/rayen-import/domain/rayenStableStringify';

describe('stableStringify (Rayen structural comparisons)', () => {
  it('ignores key order and omits undefined object entries', () => {
    expect(stableStringify({ b: 1, a: { d: undefined, c: 'x' } })).toBe('{"a":{"c":"x"},"b":1}');
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });

  it('keeps array order and writes undefined values as null', () => {
    expect(stableStringify([2, undefined, null, 1])).toBe('[2,null,null,1]');
    expect(stableStringify(undefined)).toBe('null');
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('escapes keys and strings like JSON', () => {
    expect(stableStringify({ 'a"b': 'c\n' })).toBe('{"a\\"b":"c\\n"}');
  });
});
