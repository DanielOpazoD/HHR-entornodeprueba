import { describe, expect, it } from 'vitest';
import {
  applyEgresoReport,
  markEgresoReportUnavailable,
  requiresReview,
  type CensusImportDiff,
  type EgresoReportRow,
} from '@/features/rayen-import';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const patient = (rut: string, patientName = 'Paciente'): PatientData => ({
  ...EMPTY_PATIENT,
  patientName,
  rut,
  bedId: 'R2',
});

const makeRecord = (
  beds: DailyRecord['beds'] = {},
  movements: Partial<Pick<DailyRecord, 'discharges' | 'transfers' | 'cma'>> = {}
): DailyRecord => ({
  date: '2026-07-14',
  beds,
  discharges: movements.discharges ?? [],
  transfers: movements.transfers ?? [],
  cma: movements.cma ?? [],
  lastUpdated: '',
  activeExtraBeds: [],
});

const makeDiff = (over: Partial<CensusImportDiff> = {}): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
  ...over,
});

const row = (over: Partial<EgresoReportRow>): EgresoReportRow => ({
  run: '',
  patientName: '',
  bedLabel: '',
  servicio: '',
  edad: '',
  destino: '',
  motivo: '',
  fechaEgreso: '14-07-2026  12:00',
  ...over,
});

describe('applyEgresoReport', () => {
  it('persists the verified occupant RUN when an exact report carries a stale RUN', () => {
    const exactPatient = {
      ...patient('11.044.046-4', 'Paciente Exacto'),
      clinicalEpisodeId: 'EXACT-EPISODE',
    };
    const enriched = applyEgresoReport(
      makeDiff(),
      [row({ run: '22-5', encounterId: 'EXACT-EPISODE', destino: 'Domicilio' })],
      makeRecord({ R2: exactPatient })
    );

    expect(enriched.discharges[0]).toMatchObject({ rut: '11.044.046-4' });
  });

  it('retains a collision when an exact egreso cannot identify the legacy occupant', () => {
    const legacyOccupant = patient('', 'Paciente Legado');
    const enriched = applyEgresoReport(
      makeDiff({
        conflicts: [
          {
            bedId: 'R2',
            rut: '22-5',
            patientName: 'Paciente Entrante',
            code: 'principal-bed-collision',
            reason: 'Cama ocupada por una identidad no verificable.',
            source: { encounterId: 'EXACT-EPISODE' } as never,
          },
        ],
      }),
      [row({ run: '22-5', encounterId: 'EXACT-EPISODE', destino: 'Domicilio' })],
      makeRecord({ R2: legacyOccupant })
    );

    expect(enriched.discharges).toHaveLength(0);
    expect(enriched.conflicts).toEqual([
      expect.objectContaining({ bedId: 'R2', code: 'principal-bed-collision' }),
    ]);
    expect(requiresReview(enriched)).toBe(true);
  });

  it('retains a crib conflict when the nested legacy newborn has no identity', () => {
    const mother = patient('11.044.046-4', 'Madre');
    const legacyNewborn = patient('', 'RN de Madre');
    const enriched = applyEgresoReport(
      makeDiff({
        conflicts: [
          {
            bedId: 'R2',
            rut: '',
            patientName: legacyNewborn.patientName,
            scope: 'clinical-crib',
            reason: 'Episodio de cuna no verificable.',
            source: { encounterId: 'NEWBORN-EPISODE' } as never,
          },
        ],
      }),
      [row({ run: '', encounterId: 'NEWBORN-EPISODE', destino: 'Domicilio' })],
      makeRecord({ R2: { ...mother, clinicalCrib: legacyNewborn } })
    );

    expect(enriched.conflicts).toEqual([
      expect.objectContaining({ scope: 'clinical-crib', bedId: 'R2' }),
    ]);
    expect(requiresReview(enriched)).toBe(true);
  });

  it('still discharges an occupied readmission even if the RUN has a prior movement that day', () => {
    const current = makeRecord(
      { R2: patient('11.044.046-4', 'Paciente Reingresado') },
      { discharges: [{ rut: '11.044.046-4' } as never] }
    );
    const enriched = applyEgresoReport(
      makeDiff(),
      [row({ run: '11.044.046-4', destino: 'Domicilio' })],
      current
    );
    expect(enriched.discharges).toEqual([
      expect.objectContaining({ bedId: 'R2', reason: 'administrative-discharge' }),
    ]);
  });

  it('converts the mainland report wall clock to the Rapa Nui census clock', () => {
    const current = makeRecord({ R2: patient('1-9') });
    const enriched = applyEgresoReport(
      makeDiff(),
      [row({ run: '1-9', fechaEgreso: '14-07-2026  23:37', destino: 'Domicilio' })],
      current
    );
    expect(enriched.discharges[0]).toMatchObject({
      correctedDay: '2026-07-14',
      correctedTime: '21:37',
    });
  });

  it('rejects impossible corrected values and falls back to the authoritative report stamp', () => {
    const current = makeRecord({ R2: patient('1-9') });
    const enriched = applyEgresoReport(
      makeDiff(),
      [
        row({
          run: '1-9',
          fechaEgreso: '14-07-2026  23:37',
          correctedDay: '2026-02-31',
          correctedTime: '29:75',
          destino: 'Domicilio',
        }),
      ],
      current
    );

    expect(enriched.discharges[0]).toMatchObject({
      correctedDay: '2026-07-14',
      correctedTime: '21:37',
    });
  });

  it('ignores a genuine next-day row included by the D to D+1 search window', () => {
    const current = makeRecord({ R2: patient('1-9') });
    const enriched = applyEgresoReport(
      makeDiff(),
      // 10:30 mainland = 08:30 Rapa Nui: after the 08:00 weekday handoff, so it belongs to D+1.
      [row({ run: '1-9', fechaEgreso: '15-07-2026  10:30', destino: 'Domicilio' })],
      current
    );
    expect(enriched.discharges).toHaveLength(0);
  });

  it('review-gates an invalid statistical timestamp instead of vacating the occupied bed', () => {
    const current = makeRecord({ R2: patient('1-9') });
    const enriched = applyEgresoReport(
      makeDiff(),
      [row({ run: '1-9', fechaEgreso: 'fecha desconocida', destino: 'Domicilio' })],
      current
    );

    expect(enriched.discharges).toHaveLength(0);
    expect(enriched.reportEgresos ?? []).toHaveLength(0);
    expect(enriched.conflicts).toEqual([
      expect.objectContaining({ rut: '1-9', reason: expect.stringContaining('fecha/hora') }),
    ]);
    expect(enriched.summary.conflicts).toBe(1);
    expect(requiresReview(enriched)).toBe(true);
  });

  it('ignores an earlier same-RUN egreso for a later identified readmission', () => {
    const current = makeRecord({
      R2: {
        ...patient('1-9', 'Paciente Reingresado'),
        admissionDate: '2026-07-14',
        admissionTime: '16:00',
      },
    });
    const pending = {
      bedId: 'R2',
      rut: '1-9',
      patientName: 'Paciente Reingresado',
      signal: 'clinical-closure' as const,
      encounterId: '141704',
      verification: {
        medicalEpicrisis: 'confirmed' as const,
        nursingEpicrisis: 'not-detected' as const,
        hospitalDischarge: 'unknown' as const,
      },
    };
    const enriched = applyEgresoReport(
      makeDiff({ pendingAdministrativeDischarges: [pending] }),
      [row({ run: '1-9', fechaEgreso: '14-07-2026  12:00', destino: 'Domicilio' })],
      current
    );

    expect(enriched.discharges).toHaveLength(0);
    expect(enriched.pendingAdministrativeDischarges).toEqual([
      {
        ...pending,
        verification: { ...pending.verification, hospitalDischarge: 'not-detected' },
      },
    ]);
    expect(enriched.conflicts).toHaveLength(0);
  });

  it('accepts the same-RUN egreso when its official time follows the active admission', () => {
    const current = makeRecord({
      R2: {
        ...patient('1-9'),
        admissionDate: '2026-07-14',
        admissionTime: '08:00',
      },
    });
    const enriched = applyEgresoReport(
      makeDiff(),
      [row({ run: '1-9', fechaEgreso: '14-07-2026  12:00', destino: 'Domicilio' })],
      current
    );

    expect(enriched.discharges).toEqual([
      expect.objectContaining({ bedId: 'R2', reason: 'administrative-discharge' }),
    ]);
    expect(enriched.conflicts).toHaveLength(0);
  });

  it('marks an unavailable authority report as a review-gated conflict', () => {
    const enriched = markEgresoReportUnavailable(makeDiff());

    expect(enriched.conflicts).toHaveLength(1);
    expect(enriched.summary.conflicts).toBe(1);
    expect(requiresReview(enriched)).toBe(true);
  });

  it('marks the administrative document as not detected after an empty report', () => {
    const pending = {
      bedId: 'H2C1',
      rut: '22.025.389-9',
      patientName: 'Paciente',
      signal: 'clinical-closure' as const,
      encounterId: '141704',
      verification: {
        medicalEpicrisis: 'confirmed' as const,
        nursingEpicrisis: 'confirmed' as const,
        hospitalDischarge: 'unknown' as const,
      },
    };
    const enriched = applyEgresoReport(
      makeDiff({ pendingAdministrativeDischarges: [pending] }),
      [],
      makeRecord()
    );
    expect(enriched.pendingAdministrativeDischarges[0]?.verification.hospitalDischarge).toBe(
      'not-detected'
    );
  });
});
