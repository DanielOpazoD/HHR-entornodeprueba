import { describe, expect, it } from 'vitest';
import {
  HIDDEN_CENSUS_COLUMNS,
  resolveVisibleCensusColumnCount,
  resolveVisibleCensusColumnKeys,
  resolveVisibleCensusColumns,
} from '@/features/census/controllers/censusTableColumnProfileController';

describe('censusTableColumnProfileController', () => {
  const columns = {
    actions: 50,
    bed: 80,
    type: 60,
    name: 200,
    rut: 100,
    age: 50,
    diagnosis: 200,
    specialty: 80,
    status: 100,
    admission: 100,
    dmi: 60,
    scores: 56,
    cqx: 60,
    upc: 60,
  };

  it('resolves visible column keys for specialist access', () => {
    const keys = resolveVisibleCensusColumnKeys(columns, 'specialist');

    expect(keys).not.toContain('status');
    expect(keys).not.toContain('dmi');
    expect(keys).not.toContain('cqx');
    expect(keys).not.toContain('upc');
    expect(keys).toContain('diagnosis');
  });

  it('keeps visible count aligned with resolved keys', () => {
    const keys = resolveVisibleCensusColumnKeys(columns, 'specialist');

    expect(resolveVisibleCensusColumnCount(columns, 'specialist')).toBe(keys.length);
  });

  it('hides rut, age, cqx and type columns in every access profile', () => {
    expect(HIDDEN_CENSUS_COLUMNS).toEqual(['rut', 'age', 'cqx', 'type']);

    for (const accessProfile of ['default', 'specialist'] as const) {
      const keys = resolveVisibleCensusColumnKeys(columns, accessProfile);

      expect(keys).not.toContain('rut');
      expect(keys).not.toContain('age');
      expect(keys).not.toContain('cqx');
      expect(keys).not.toContain('type');
      expect(keys).toContain('name');
      expect(resolveVisibleCensusColumnCount(columns, accessProfile)).toBe(keys.length);
    }
  });

  it('zeroes hidden column widths in the projected columns (incl. type, both profiles)', () => {
    for (const accessProfile of ['default', 'specialist'] as const) {
      const projected = resolveVisibleCensusColumns(columns, accessProfile);
      expect(projected.rut).toBe(0);
      expect(projected.age).toBe(0);
      expect(projected.cqx).toBe(0);
      expect(projected.type).toBe(0); // type is hidden even in the specialist profile
    }
    expect(resolveVisibleCensusColumns(columns, 'default').name).toBe(columns.name);
  });
});
