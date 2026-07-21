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
  run: '222222222',
  firstGivenName: 'Bebe',
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
