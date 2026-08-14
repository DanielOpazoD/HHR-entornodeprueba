import { describe, expect, it } from 'vitest';

import '../../../extension/clinical-day-runtime.js';
import '../../../extension/gestion-camas-egreso-lookup.js';

const lookup = (
  globalThis as typeof globalThis & {
    HhrGestionCamasEgresoLookup: {
      normalizeTargets: (
        runs: unknown[],
        targets?: unknown[]
      ) => Array<{ run: string; encounterId: string; dischargeDay?: string }>;
      pickMetadata: (payload: unknown) => Record<string, unknown>;
      selectEncounter: (
        payload: unknown,
        encounterId: string,
        dischargeDay?: string
      ) => Record<string, unknown> | null;
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

  it('resolves one report-only episode by its discharge day instead of taking the first row', () => {
    const payload = [
      { id: 120001, endPeriod: '2025-01-02T10:00:00-03:00' },
      { id: 143322, dateDischarge: '2026-08-13T22:29:00-04:00' },
    ];

    expect(lookup.selectEncounter(payload, '', '2026-08-13')).toMatchObject({ id: 143322 });
    expect(lookup.selectEncounter(payload, '', '2026-08-14')).toBeNull();
  });

  it('fails closed when two episodes for the RUN share the requested discharge day', () => {
    expect(
      lookup.selectEncounter(
        [
          { id: 143322, endPeriod: '2026-08-13T20:29:00-06:00' },
          { id: 143323, endPeriod: '2026-08-13T23:00:00-06:00' },
        ],
        '',
        '2026-08-13'
      )
    ).toBeNull();
  });

  it('converts offset-bearing timestamps to the Rapa Nui discharge day', () => {
    expect(
      lookup.selectEncounter(
        [{ id: 143322, dateDischarge: '2026-08-14T01:00:00-04:00' }],
        '',
        '2026-08-13'
      )
    ).toMatchObject({ id: 143322 });
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
