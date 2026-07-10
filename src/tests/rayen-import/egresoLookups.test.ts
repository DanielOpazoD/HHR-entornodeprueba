import { describe, expect, it } from 'vitest';
import {
  mapEgresoToDischarge,
  applyEgresoLookups,
  runsNeedingEgresoLookup,
  requiresReview,
  type CensusImportDiff,
  type DischargeEntry,
  type EgresoLookupResult,
} from '@/features/rayen-import';

const makeDiff = (over: Partial<CensusImportDiff> = {}): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingNursingDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingNursingDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
  ...over,
});

const missingDischarge = (rut: string): DischargeEntry => ({
  bedId: 'R2',
  rut,
  patientName: 'Paciente',
  kind: 'alta',
  status: 'Vivo',
  reason: 'missing-in-rayen',
});

describe('mapEgresoToDischarge', () => {
  it('classifies a home discharge as alta', () => {
    expect(mapEgresoToDischarge({ dischargeDestination: 'Domicilio (Habitual)' })).toEqual({
      kind: 'alta',
      status: 'Vivo',
    });
  });

  it('classifies a transfer as traslado (accent-insensitive)', () => {
    expect(
      mapEgresoToDischarge({ dischargeDestinationName: 'Trasladó a otro establecimiento' })
    ).toEqual({ kind: 'traslado', status: 'Vivo' });
  });

  it('classifies a CMA egreso', () => {
    expect(mapEgresoToDischarge({ dischargeTypeName: 'Cirugía Mayor Ambulatoria' })).toEqual({
      kind: 'cma',
      status: 'Vivo',
    });
  });

  it('marks Fallecido from isDead', () => {
    expect(mapEgresoToDischarge({ isDead: true }).status).toBe('Fallecido');
  });

  it('defaults to a plain alta when no destination text is present', () => {
    expect(mapEgresoToDischarge({ id: 1 })).toEqual({ kind: 'alta', status: 'Vivo' });
  });
});

describe('applyEgresoLookups', () => {
  it('lists the RUNs of the inferred discharges that need a lookup', () => {
    const diff = makeDiff({
      discharges: [missingDischarge('11.111.111-1'), missingDischarge('2-7')],
    });
    expect(runsNeedingEgresoLookup(diff)).toEqual(['11.111.111-1', '2-7']);
  });

  it('upgrades an inferred discharge to a confirmed traslado from the lookup', () => {
    const diff = makeDiff({
      discharges: [missingDischarge('28.663.707-8')],
      summary: {
        admissions: 0,
        updates: 0,
        moves: 0,
        discharges: 1,
        pendingNursingDischarges: 0,
        conflicts: 0,
        unchanged: 0,
      },
    });
    const results: EgresoLookupResult[] = [
      {
        run: '28663707-8',
        egreso: { id: 141179, dischargeDestination: 'Traslado a otro hospital' },
      },
    ];
    const enriched = applyEgresoLookups(diff, results);
    expect(enriched.discharges[0]).toMatchObject({ kind: 'traslado', reason: 'rayen-discharge' });
    // Confirmed by gestión de camas → no longer an inferred, review-gated discharge.
    expect(requiresReview(enriched)).toBe(false);
  });

  it('leaves an inferred discharge untouched when no egreso is found', () => {
    const diff = makeDiff({ discharges: [missingDischarge('9-9')] });
    const enriched = applyEgresoLookups(diff, [{ run: '9-9', error: 'HTTP 404' }]);
    expect(enriched.discharges[0].reason).toBe('missing-in-rayen');
    expect(requiresReview(enriched)).toBe(true);
  });
});
