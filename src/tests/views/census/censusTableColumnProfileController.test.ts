import { describe, expect, it } from 'vitest';
import {
  resolveVisibleCensusColumnCount,
  resolveVisibleCensusColumnKeys,
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
});
