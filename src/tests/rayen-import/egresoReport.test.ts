import { describe, expect, it } from 'vitest';
import {
  applyEgresoReport,
  collectRecordedMovementRuns,
  mapDestinoDeAlta,
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

describe('mapDestinoDeAlta', () => {
  it('maps the three statistical destinations and deceased status', () => {
    expect(mapDestinoDeAlta('Domicilio', 'Alta hospitalaria')).toEqual({
      kind: 'alta',
      status: 'Vivo',
    });
    expect(mapDestinoDeAlta('Trasladó a otro establecimiento').kind).toBe('traslado');
    expect(mapDestinoDeAlta('Cirugía Mayor Ambulatoria').kind).toBe('cma');
    expect(mapDestinoDeAlta('Fallecido').status).toBe('Fallecido');
  });
});

describe('applyEgresoReport', () => {
  it('creates the definitive movement for an occupied patient and removes provisional Ficha plans', () => {
    const current = makeRecord({ R2: patient('28.663.707-8', 'Isidora Soto') });
    const diff = makeDiff({
      updates: [
        {
          bedId: 'R2',
          rut: '28.663.707-8',
          patientName: 'Isidora Soto',
          changes: [],
          patient: current.beds.R2,
          source: {} as never,
        },
      ],
      pendingAdministrativeDischarges: [
        {
          bedId: 'R2',
          rut: '28.663.707-8',
          patientName: 'Isidora Soto',
          signal: 'clinical-closure',
          encounterId: '141704',
          verification: {
            medicalEpicrisis: 'confirmed',
            nursingEpicrisis: 'confirmed',
            hospitalDischarge: 'unknown',
          },
        },
      ],
    });
    const enriched = applyEgresoReport(
      diff,
      [row({ run: '28663707-8', destino: 'Traslado a otro hospital' })],
      current
    );

    expect(enriched.discharges[0]).toMatchObject({
      bedId: 'R2',
      kind: 'traslado',
      reason: 'administrative-discharge',
    });
    expect(enriched.updates).toHaveLength(0);
    expect(enriched.pendingAdministrativeDischarges).toHaveLength(0);
    expect(requiresReview(enriched)).toBe(false);
  });

  it('removes an administratively discharged patient from the unchanged aggregate', () => {
    const current = makeRecord({ R2: patient('28.663.707-8', 'Isidora Soto') });
    const enriched = applyEgresoReport(
      makeDiff({
        unchangedCount: 1,
        summary: {
          admissions: 0,
          updates: 0,
          moves: 0,
          discharges: 0,
          pendingAdministrativeDischarges: 0,
          conflicts: 0,
          unchanged: 1,
        },
      }),
      [row({ run: '28663707-8', destino: 'Domicilio' })],
      current
    );

    expect(enriched.unchangedCount).toBe(0);
    expect(enriched.summary.unchanged).toBe(0);
    expect(enriched.summary.discharges).toBe(1);
  });

  it.each(['CMA R1', 'CMA R2', 'CMA R3', 'CMA R4', 'CMA NEO1', 'CMA NEO2'])(
    'classifies a same-day administrative discharge from report bed %s as CMA',
    bedLabel => {
      const current = makeRecord({
        R2: {
          ...patient('28.663.707-8', 'Isidora Soto'),
          admissionDate: '2026-07-14',
        },
      });
      const enriched = applyEgresoReport(
        makeDiff(),
        [
          row({
            run: '28663707-8',
            bedLabel,
            destino: 'Domicilio',
            fechaEgreso: '14-07-2026  12:00',
          }),
        ],
        current
      );

      expect(enriched.discharges[0]).toMatchObject({
        bedId: 'R2',
        kind: 'cma',
        reason: 'administrative-discharge',
      });
    }
  );

  it('classifies CMA from the Eloísa source location even when the report prints physical bed R1', () => {
    const current = makeRecord({
      R1: {
        ...patient('28.663.707-8', 'Isidora Soto'),
        bedId: 'R1',
        admissionDate: '2026-07-14',
        location: 'Área quirúrgica indiferenciada / CMA R1 / CMA R1',
      },
    });
    const enriched = applyEgresoReport(
      makeDiff(),
      [row({ run: '28663707-8', bedLabel: 'R1', destino: 'Domicilio' })],
      current
    );

    expect(enriched.discharges[0]?.kind).toBe('cma');
  });

  it('does not confuse ordinary R1 with CMA R1', () => {
    const current = makeRecord({
      R1: {
        ...patient('28.663.707-8', 'Isidora Soto'),
        bedId: 'R1',
        admissionDate: '2026-07-14',
        location: 'Área Médico Quirúrgica Indiferenciada / Recuperación 1 / R1',
      },
    });
    const enriched = applyEgresoReport(
      makeDiff(),
      [row({ run: '28663707-8', bedLabel: 'R1', destino: 'Domicilio' })],
      current
    );

    expect(enriched.discharges[0]?.kind).toBe('alta');
  });

  it('keeps a CMA-bed discharge as a regular alta when the admission was on a previous day', () => {
    const current = makeRecord({
      R2: {
        ...patient('28.663.707-8'),
        admissionDate: '2026-07-13',
      },
    });
    const enriched = applyEgresoReport(
      makeDiff(),
      [row({ run: '28663707-8', bedLabel: 'CMA R2', destino: 'Domicilio' })],
      current
    );

    expect(enriched.discharges[0]?.kind).toBe('alta');
  });

  it('preserves an explicit transfer from a CMA bed instead of hiding it as CMA', () => {
    const current = makeRecord({
      R2: {
        ...patient('28.663.707-8'),
        admissionDate: '2026-07-14',
      },
    });
    const enriched = applyEgresoReport(
      makeDiff(),
      [row({ run: '28663707-8', bedLabel: 'CMA R2', destino: 'Traslado a otro hospital' })],
      current
    );

    expect(enriched.discharges[0]?.kind).toBe('traslado');
  });

  it('preserves a death from a CMA bed instead of classifying it as ambulatory CMA', () => {
    const current = makeRecord({
      R2: {
        ...patient('28.663.707-8'),
        admissionDate: '2026-07-14',
      },
    });
    const enriched = applyEgresoReport(
      makeDiff(),
      [
        row({
          run: '28663707-8',
          bedLabel: 'CMA R2',
          destino: 'Domicilio',
          motivo: 'Fallecido',
        }),
      ],
      current
    );

    expect(enriched.discharges[0]).toMatchObject({ kind: 'alta', status: 'Fallecido' });
  });

  it('surfaces an administrative egreso not represented in HHR for review', () => {
    const enriched = applyEgresoReport(
      makeDiff(),
      [
        row({
          run: '11.044.046-4',
          patientName: 'LORENA  LOPEZ ALVARADO',
          bedLabel: 'Neo2',
          destino: 'Domicilio',
        }),
      ],
      makeRecord()
    );
    expect(enriched.reportEgresos?.[0]).toMatchObject({
      patientName: 'Lorena Lopez Alvarado',
      bedLabel: 'NEO2',
      kind: 'alta',
    });
    expect(requiresReview(enriched)).toBe(true);
  });

  it('does not duplicate a RUN already represented by a movement', () => {
    const current = makeRecord({}, { discharges: [{ rut: '11.044.046-4' } as never] });
    const enriched = applyEgresoReport(
      makeDiff(),
      [row({ run: '11.044.046-4', destino: 'Domicilio' })],
      current
    );
    expect(enriched.discharges).toHaveLength(0);
    expect(enriched.reportEgresos ?? []).toHaveLength(0);
  });

  it('does not let a legacy movement suppress a later exact episode', () => {
    const current = makeRecord({}, { discharges: [{ rut: '11.044.046-4' } as never] });
    const enriched = applyEgresoReport(
      makeDiff(),
      [row({ run: '11.044.046-4', encounterId: 'NEW-EPISODE', destino: 'Domicilio' })],
      current
    );

    expect(enriched.reportEgresos).toEqual([
      expect.objectContaining({ encounterId: 'NEW-EPISODE' }),
    ]);
  });

  it('discharges a RUN-less occupied principal by exact episode', () => {
    const exactPatient = { ...patient('', 'Paciente NN'), clinicalEpisodeId: 'EXACT-EPISODE' };
    const enriched = applyEgresoReport(
      makeDiff(),
      [row({ run: '', encounterId: 'EXACT-EPISODE', destino: 'Domicilio' })],
      makeRecord({ R2: exactPatient })
    );

    expect(enriched.discharges).toEqual([
      expect.objectContaining({ bedId: 'R2', encounterId: 'EXACT-EPISODE' }),
    ]);
    expect(enriched.reportEgresos ?? []).toHaveLength(0);
  });

  it('does not subtract unrelated unchanged patients for a planned RUN-less episode', () => {
    const exactPatient = { ...patient('', 'Paciente NN'), clinicalEpisodeId: 'EXACT-EPISODE' };
    const diff = makeDiff({
      unchangedCount: 1,
      summary: { ...makeDiff().summary, updates: 1, unchanged: 1 },
      updates: [{
        bedId: 'R2',
        rut: '',
        patientName: 'Paciente NN',
        changes: [],
        patient: exactPatient,
        source: { encounterId: 'EXACT-EPISODE' } as never,
      }],
    });
    const enriched = applyEgresoReport(
      diff,
      [row({ run: '', encounterId: 'EXACT-EPISODE', destino: 'Domicilio' })],
      makeRecord({ R2: exactPatient })
    );

    expect(enriched.summary.unchanged).toBe(1);
  });

  it('deduplicates an exact episode even when the stored RUN differs', () => {
    const current = makeRecord({}, {
      discharges: [{ rut: '1-9', clinicalEpisodeId: 'EXACT-EPISODE' } as never],
    });
    const enriched = applyEgresoReport(
      makeDiff(),
      [row({ run: '22-5', encounterId: 'EXACT-EPISODE', destino: 'Domicilio' })],
      current
    );

    expect(enriched.reportEgresos ?? []).toHaveLength(0);
  });

  it('removes a planned operation by exact episode even when report RUN differs', () => {
    const exactPatient = {
      ...patient('11.044.046-4', 'Paciente Exacto'),
      clinicalEpisodeId: 'EXACT-EPISODE',
    };
    const enriched = applyEgresoReport(
      makeDiff({
        moves: [{
          fromBedId: 'R2',
          toBedId: 'R3',
          rut: exactPatient.rut,
          patientName: exactPatient.patientName,
          source: { encounterId: 'EXACT-EPISODE' } as never,
        }],
      }),
      [row({ run: '22-5', encounterId: 'EXACT-EPISODE', destino: 'Domicilio' })],
      makeRecord({ R2: exactPatient })
    );

    expect(enriched.moves).toHaveLength(0);
    expect(enriched.discharges).toEqual([
      expect.objectContaining({ bedId: 'R2', encounterId: 'EXACT-EPISODE' }),
    ]);
  });

  it('deduplicates report rows for one exact episode even when their RUN differs', () => {
    const enriched = applyEgresoReport(
      makeDiff(),
      [
        row({ run: '11.044.046-4', encounterId: 'EXACT-EPISODE', destino: 'Domicilio' }),
        row({ run: '22-5', encounterId: 'EXACT-EPISODE', destino: 'Domicilio' }),
      ],
      makeRecord()
    );

    expect(enriched.reportEgresos).toHaveLength(1);
    expect(enriched.reportEgresos?.[0]).toMatchObject({ encounterId: 'EXACT-EPISODE' });
  });

  it('prefers one exact row over an episode-less row for the same occupied RUN', () => {
    const exactPatient = {
      ...patient('11.044.046-4', 'Paciente Exacto'),
      clinicalEpisodeId: 'EXACT-EPISODE',
    };
    const enriched = applyEgresoReport(
      makeDiff(),
      [
        row({ run: exactPatient.rut, destino: 'Domicilio' }),
        row({ run: exactPatient.rut, encounterId: 'EXACT-EPISODE', destino: 'Domicilio' }),
      ],
      makeRecord({ R2: exactPatient })
    );

    expect(enriched.discharges).toHaveLength(1);
    expect(enriched.discharges[0]).toMatchObject({ encounterId: 'EXACT-EPISODE' });
    expect(enriched.reportEgresos ?? []).toHaveLength(0);
  });

  it('keeps an episode-less active discharge beside an older exact episode', () => {
    const active = {
      ...patient('11.044.046-4', 'Paciente Readmitido'),
      clinicalEpisodeId: 'ACTIVE-EPISODE',
    };
    const enriched = applyEgresoReport(
      makeDiff(),
      [
        row({ run: active.rut, encounterId: 'OLDER-EPISODE', destino: 'Domicilio' }),
        row({ run: active.rut, destino: 'Domicilio', fechaEgreso: '14-07-2026 13:00' }),
      ],
      makeRecord({ R2: active })
    );

    expect(enriched.discharges).toEqual([
      expect.objectContaining({ bedId: 'R2', encounterId: 'ACTIVE-EPISODE' }),
    ]);
    expect(enriched.reportEgresos).toEqual([
      expect.objectContaining({ encounterId: 'OLDER-EPISODE' }),
    ]);
  });

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
        conflicts: [{
          bedId: 'R2',
          rut: '22-5',
          patientName: 'Paciente Entrante',
          code: 'principal-bed-collision',
          reason: 'Cama ocupada por una identidad no verificable.',
          source: { encounterId: 'EXACT-EPISODE' } as never,
        }],
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
      makeDiff({ conflicts: [{
        bedId: 'R2', rut: '', patientName: legacyNewborn.patientName,
        scope: 'clinical-crib', reason: 'Episodio de cuna no verificable.',
        source: { encounterId: 'NEWBORN-EPISODE' } as never,
      }] }),
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
      [row({
        run: '1-9',
        fechaEgreso: '14-07-2026  23:37',
        correctedDay: '2026-02-31',
        correctedTime: '29:75',
        destino: 'Domicilio',
      })],
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
      [row({ run: '1-9', fechaEgreso: '15-07-2026  08:00', destino: 'Domicilio' })],
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

  it('does not apply an earlier same-RUN egreso to a later active readmission', () => {
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
    expect(enriched.conflicts).toEqual([
      expect.objectContaining({ bedId: 'R2', reason: expect.stringContaining('ingreso activo') }),
    ]);
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

describe('collectRecordedMovementRuns', () => {
  it('collects active and tombstoned historical movements but not occupied beds', () => {
    const record = makeRecord(
      { R2: patient('1-9') },
      {
        discharges: [{ rut: '2-7' } as never],
        transfers: [{ rut: '3-5', deletedAt: '2026-07-14T12:00:00Z' } as never],
      }
    );
    const known = collectRecordedMovementRuns(record);
    expect(known.has('27')).toBe(true);
    expect(known.has('35')).toBe(true);
    expect(known.has('19')).toBe(false);
  });
});
