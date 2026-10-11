// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { deepClone } from '@/utils/deepClone';

describe('deepClone', () => {
  it('creates an independent deep copy of nested structures', () => {
    const original = {
      name: 'Paciente',
      nested: {
        values: [1, 2, 3],
      },
    };

    const cloned = deepClone(original);

    cloned.nested.values.push(4);

    expect(cloned).not.toBe(original);
    expect(cloned.nested).not.toBe(original.nested);
    expect(original.nested.values).toEqual([1, 2, 3]);
    expect(cloned.nested.values).toEqual([1, 2, 3, 4]);
  });

  it('preserves primitives and null values', () => {
    expect(deepClone(null)).toBeNull();
    expect(deepClone(undefined)).toBeUndefined();
    expect(deepClone('texto')).toBe('texto');
    expect(deepClone(42)).toBe(42);
  });
});
