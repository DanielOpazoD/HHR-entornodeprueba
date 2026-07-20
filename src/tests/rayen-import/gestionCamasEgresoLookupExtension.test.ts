import { describe, expect, it } from 'vitest';

import '../../../extension/gestion-camas-egreso-lookup.js';

const lookup = (
  globalThis as typeof globalThis & {
    HhrGestionCamasEgresoLookup: {
      normalizeTargets: (
        runs: unknown[],
        targets?: unknown[]
      ) => Array<{ run: string; encounterId: string }>;
      pickMetadata: (payload: unknown) => Record<string, unknown>;
      selectEncounter: (payload: unknown, encounterId: string) => Record<string, unknown> | null;
    };
  }
).HhrGestionCamasEgresoLookup;

describe('Gestión de Camas exact-episode discharge lookup', () => {
  it('normalizes RUNs while retaining the requested hospitalization id', () => {
    expect(lookup.normalizeTargets([], [{ run: '22.025.389-9', encounterId: '141704' }])).toEqual([
      { run: '220253899', encounterId: '141704' },
    ]);
  });

  it('selects encounter 141704 instead of the first hospitalization for the same RUN', () => {
    expect(
      lookup.selectEncounter(
        [
          { id: 120001, endPeriod: '2025-01-02T10:00:00-03:00' },
          { id: 141704, endPeriod: '2026-07-19T17:10:00-04:00' },
        ],
        '141704'
      )
    ).toMatchObject({ id: 141704 });
  });

  it('fails closed when Gestión de Camas returns only another episode', () => {
    expect(lookup.selectEncounter([{ id: 120001 }], '141704')).toBeNull();
  });

  it('forwards only approved discharge metadata and excludes patient identifiers', () => {
    expect(
      lookup.pickMetadata({
        id: 141704,
        hasAdministrativeDischarge: true,
        dischargeDestinationName: 'Domicilio',
        patientName: 'Dato clínico no permitido',
        rut: '22.025.389-9',
      })
    ).toEqual({
      id: 141704,
      hasAdministrativeDischarge: true,
      dischargeDestinationName: 'Domicilio',
    });
  });
});
