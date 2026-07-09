import { describe, expect, it } from 'vitest';
import { resolveDischargeIntent, type RayenEncounter } from '@/features/rayen-import';

const encounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'E1',
  run: '144700554',
  firstGivenName: 'Ana',
  firstFamilyName: 'Perez',
  ...overrides,
});

describe('resolveDischargeIntent', () => {
  it('resolves a CMA discharge when the source is the virtual CMA service', () => {
    expect(resolveDischargeIntent(encounter(), true)).toEqual({ kind: 'cma', status: 'Vivo' });
  });

  it('resolves a regular alta for a non-CMA discharge', () => {
    expect(resolveDischargeIntent(encounter(), false)).toEqual({
      kind: 'alta',
      status: 'Vivo',
    });
  });

  it('marks status Fallecido when the patient is deceased', () => {
    expect(resolveDischargeIntent(encounter({ isDead: true }), false).status).toBe('Fallecido');
    expect(resolveDischargeIntent(encounter({ isDead: true }), true)).toEqual({
      kind: 'cma',
      status: 'Fallecido',
    });
  });
});
