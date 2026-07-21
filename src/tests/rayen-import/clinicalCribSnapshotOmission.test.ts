import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  applyEgresoReport,
  reconcileCensus,
  rayenToPatientData,
  type EgresoReportRow,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const REFERENCE = new Date(2026, 6, 8);

const mother: RayenEncounter = {
  encounterId: 'MOTHER',
  run: '144700554',
  firstGivenName: 'Ana',
  firstFamilyName: 'Perez',
  birthDate: '1980-01-01',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H5',
  bed: 'C1',
  admissionDatetime: '2026-07-08T10:00:00-06:00',
  diagnosis: 'Control',
};

const child: RayenEncounter = {
  ...mother,
  encounterId: 'NEWBORN',
  run: '',
  firstGivenName: 'RN de Ana',
  birthDate: '2026-07-08',
  room: 'Cunas',
  bed: 'CH5C1',
  clinicalCribParentBedId: 'H5C1',
};

const seed = (encounter: RayenEncounter) => rayenToPatientData(encounter, REFERENCE).patient;

const record: DailyRecord = {
  date: '2026-07-08',
  beds: { H5C1: { ...seed(mother), clinicalCrib: seed(child) } },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
};

const snapshot: RayenCensusSnapshot = {
  capturedAt: '2026-07-08T20:00:00-06:00',
  facilityId: 1342,
  encounters: [mother],
};

const motherDischarge: EgresoReportRow = {
  encounterId: mother.encounterId,
  run: mother.run,
  patientName: 'Ana Perez',
  bedLabel: 'H5C1',
  servicio: mother.service ?? '',
  edad: '40',
  destino: 'Domicilio',
  motivo: 'Alta hospitalaria',
  fechaEgreso: '08-07-2026 12:00',
};

describe('clinical crib snapshot omission', () => {
  it('retains a promoted newborn when verified bed enrichment is temporarily unavailable', () => {
    const promoted = { ...seed(child), bedId: 'H5C1', bedMode: 'Cuna' as const };
    const current: DailyRecord = { ...record, beds: { H5C1: promoted } };
    const unenrichedChild = { ...child, clinicalCribParentBedId: undefined };
    const diff = reconcileCensus(current, { ...snapshot, encounters: [unenrichedChild] }, {
      reference: REFERENCE,
    });

    expect(diff.conflicts).toHaveLength(0);
    expect(diff.admissions).toHaveLength(0);
    expect(diff.summary.unchanged).toBe(1);
  });

  it('retains a known crib when verified bed enrichment is temporarily unavailable', () => {
    const unenrichedChild = { ...child, clinicalCribParentBedId: undefined };
    const diff = reconcileCensus(record, { ...snapshot, encounters: [mother, unenrichedChild] }, {
      reference: REFERENCE,
    });

    expect(diff.conflicts).toHaveLength(0);
    expect(diff.admissions).toHaveLength(0);
    expect(diff.updates).toHaveLength(0);
    expect(diff.summary.unchanged).toBe(2);
  });

  it('carries an unenriched known crib with its principal patient move', () => {
    const priorMother = { ...mother, room: 'H4' };
    const current: DailyRecord = {
      ...record,
      beds: { H4C1: { ...seed(priorMother), clinicalCrib: seed(child) } },
    };
    const unenrichedChild = { ...child, clinicalCribParentBedId: undefined };
    const diff = reconcileCensus(current, {
      ...snapshot, encounters: [mother, unenrichedChild],
    }, { reference: REFERENCE });
    const applied = applyCensusImportDiff(current, diff, {
      idFactory: () => 'unenriched-parent-move', now: REFERENCE, syncRunId: 'unenriched-parent-move',
    });

    expect(diff.conflicts).toHaveLength(0);
    expect(applied.record.beds.H5C1.clinicalCrib).toMatchObject({ clinicalEpisodeId: 'NEWBORN' });
  });

  it('retains and promotes the nested newborn when one snapshot omits it', () => {
    const diff = reconcileCensus(record, snapshot, { reference: REFERENCE });
    const enriched = applyEgresoReport(diff, [motherDischarge], record);
    const applied = applyCensusImportDiff(record, enriched, {
      idFactory: () => 'movement-id',
      now: REFERENCE,
      syncRunId: 'crib-snapshot-omission',
    });

    expect(enriched.conflicts).toHaveLength(0);
    expect(enriched.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({
          clinicalEpisodeId: 'NEWBORN',
          bedMode: 'Cuna',
        }),
      }),
    ]);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
      bedMode: 'Cuna',
    });
  });

  it('promotes an omitted newborn without RUN and preserves its local clinical notes', () => {
    const childWithoutRun = { ...child, run: '' };
    const current: DailyRecord = {
      ...record,
      beds: {
        H5C1: {
          ...seed(mother),
          clinicalCrib: { ...seed(childWithoutRun), handoffNote: 'Vigilancia neonatal' },
        },
      },
    };
    const diff = reconcileCensus(current, snapshot, { reference: REFERENCE });
    const enriched = applyEgresoReport(diff, [motherDischarge], current);
    const applied = applyCensusImportDiff(current, enriched, {
      idFactory: () => 'movement-without-run',
      now: REFERENCE,
      syncRunId: 'crib-without-run',
    });

    expect(enriched.conflicts).toHaveLength(0);
    expect(enriched.summary.unchanged).toBe(0);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
      bedMode: 'Cuna',
      handoffNote: 'Vigilancia neonatal',
    });
  });

  it('matches a visible newborn without RUN by episode and preserves local notes', () => {
    const childWithoutRun = { ...child, run: '' };
    const current: DailyRecord = {
      ...record,
      beds: {
        H5C1: {
          ...seed(mother),
          clinicalCrib: { ...seed(childWithoutRun), handoffNote: 'Control térmico' },
        },
      },
    };
    const currentSnapshot = { ...snapshot, encounters: [mother, childWithoutRun] };
    const diff = reconcileCensus(current, currentSnapshot, { reference: REFERENCE });
    const enriched = applyEgresoReport(diff, [motherDischarge], current);
    const applied = applyCensusImportDiff(current, enriched, {
      idFactory: () => 'movement-by-episode',
      now: REFERENCE,
      syncRunId: 'crib-without-run-by-episode',
    });

    expect(enriched.conflicts).toHaveLength(0);
    expect(enriched.summary.unchanged).toBe(0);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
      bedMode: 'Cuna',
      handoffNote: 'Control térmico',
    });
  });

  it('promotes the omitted nested newborn at the moved mother destination', () => {
    const priorMother = { ...mother, room: 'H4' };
    const current: DailyRecord = {
      ...record,
      beds: { H4C1: { ...seed(priorMother), clinicalCrib: seed(child) } },
    };
    const diff = reconcileCensus(current, snapshot, { reference: REFERENCE });
    const enriched = applyEgresoReport(diff, [motherDischarge], current);
    const applied = applyCensusImportDiff(current, enriched, {
      idFactory: () => 'movement-id',
      now: REFERENCE,
      syncRunId: 'crib-snapshot-omission-after-move',
    });

    expect(enriched.conflicts).toHaveLength(0);
    expect(enriched.moves).toHaveLength(0);
    expect(enriched.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({
          clinicalEpisodeId: 'NEWBORN',
          bedMode: 'Cuna',
        }),
      }),
    ]);
    expect(applied.record.beds.H4C1).toBeUndefined();
    expect(applied.record.beds.H5C1).toMatchObject({ clinicalEpisodeId: 'NEWBORN' });
  });
});
