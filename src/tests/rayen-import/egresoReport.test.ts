import { describe, expect, it } from 'vitest';
import {
  mapDestinoDeAlta,
  applyEgresoReport,
  collectKnownRuns,
  requiresReview,
  type CensusImportDiff,
  type DischargeEntry,
  type EgresoReportRow,
  type RayenCensusSnapshot,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

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

const row = (over: Partial<EgresoReportRow>): EgresoReportRow => ({
  run: '',
  patientName: '',
  bedLabel: '',
  servicio: '',
  edad: '',
  destino: '',
  motivo: '',
  fechaEgreso: '',
  ...over,
});

describe('mapDestinoDeAlta', () => {
  it('maps Domicilio → alta / Vivo', () => {
    expect(mapDestinoDeAlta('Domicilio', 'Alta hospitalaria')).toEqual({
      kind: 'alta',
      status: 'Vivo',
    });
  });

  it('maps a transfer → traslado (accent-insensitive)', () => {
    expect(mapDestinoDeAlta('Trasladó a otro establecimiento')).toEqual({
      kind: 'traslado',
      status: 'Vivo',
    });
  });

  it('maps Cirugía Mayor Ambulatoria → cma', () => {
    expect(mapDestinoDeAlta('Cirugía Mayor Ambulatoria')).toEqual({ kind: 'cma', status: 'Vivo' });
  });

  it('marks Fallecido from the destination text', () => {
    expect(mapDestinoDeAlta('Fallecido').status).toBe('Fallecido');
  });

  it('defaults to a plain alta when there is no destination', () => {
    expect(mapDestinoDeAlta('', '')).toEqual({ kind: 'alta', status: 'Vivo' });
  });
});

describe('applyEgresoReport', () => {
  it('confirms + enriches a known discharge with the report destination', () => {
    const diff = makeDiff({ discharges: [missingDischarge('28.663.707-8')] });
    const rows = [
      row({ run: '28663707-8', destino: 'Traslado a otro hospital', patientName: 'Isidora' }),
    ];
    const enriched = applyEgresoReport(diff, rows, new Set(['286637078']));
    expect(enriched.discharges[0]).toMatchObject({ kind: 'traslado', reason: 'rayen-discharge' });
    // Confirmed by the report → no longer a review-gated inferred discharge.
    expect(enriched.discharges[0].reason).not.toBe('missing-in-rayen');
  });

  it('surfaces a never-synced egreso (unknown RUN), normalizing the name and bed', () => {
    const diff = makeDiff();
    const rows = [
      row({
        run: '11.044.046-4',
        patientName: 'LORENA  LOPEZ ALVARADO', // uppercase + double space, as printed
        bedLabel: 'Neo2', // report casing, not the HHR bed id
        destino: 'Domicilio',
      }),
    ];
    const enriched = applyEgresoReport(diff, rows, new Set()); // HHR knows nobody
    expect(enriched.reportEgresos).toHaveLength(1);
    expect(enriched.reportEgresos?.[0]).toMatchObject({
      run: '11.044.046-4',
      patientName: 'Lorena Lopez Alvarado', // Title Case, spaces collapsed
      bedLabel: 'NEO2', // resolved to the canonical HHR bed id
      kind: 'alta',
    });
    expect(requiresReview(enriched)).toBe(true);
  });

  it('does NOT surface an egreso whose RUN HHR already knows', () => {
    const diff = makeDiff();
    const rows = [row({ run: '11.044.046-4' })];
    const enriched = applyEgresoReport(diff, rows, new Set(['110440464']));
    expect(enriched.reportEgresos ?? []).toHaveLength(0);
  });

  it('returns the diff untouched for an empty report', () => {
    const diff = makeDiff({ discharges: [missingDischarge('1-9')] });
    expect(applyEgresoReport(diff, [], new Set())).toBe(diff);
  });
});

describe('collectKnownRuns', () => {
  it('collects RUNs from beds, HHR discharges/transfers and the snapshot', () => {
    const record = {
      date: '2026-07-09',
      beds: { A1: { rut: '1-9', patientName: 'X' } },
      discharges: [{ rut: '2-7' }],
      cma: [],
      transfers: [{ rut: '3-5' }],
    } as unknown as DailyRecord;
    const snapshot = {
      facilityId: 1342,
      capturedAt: 'now',
      encounters: [{ run: '4-3' }],
    } as unknown as RayenCensusSnapshot;

    const known = collectKnownRuns(record, snapshot);
    expect(known.has('19')).toBe(true); // bed 1-9
    expect(known.has('27')).toBe(true); // discharge 2-7
    expect(known.has('35')).toBe(true); // transfer 3-5
    expect(known.has('43')).toBe(true); // snapshot 4-3
    expect(known.has('99')).toBe(false);
  });
});
