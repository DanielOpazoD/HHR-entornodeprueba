import { describe, expect, it } from 'vitest';

import {
  convertCmaToHomeDischargeRecord,
  convertCmaToTransferRecord,
  convertDischargeToCmaRecord,
  convertDischargeToTransferRecord,
  convertTransferToCmaRecord,
  convertTransferToHomeDischargeRecord,
  selectMovementReclassificationSummary,
} from '@/application/census/movementTypeConversionPolicy';
import {
  getActiveCma,
  getActiveDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';
import { DataFactory } from '@/tests/factories/DataFactory';

const RECLASSIFICATION_CONTEXT = {
  actor: 'enfermera@hospital.cl',
  at: '2026-05-14T18:30:00.000Z',
};

describe('movementTypeConversionPolicy', () => {
  it('converts an active home discharge into CMA while tombstoning the original movement', () => {
    const originalData = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente Uno',
      rut: '11.111.111-1',
      birthDate: '1980-01-01',
      biologicalSex: 'Femenino',
      clinicalEpisodeId: 'episode-1',
    });
    const record = DataFactory.createMockDailyRecord('2026-05-14', {
      discharges: [
        DataFactory.createMockDischarge({
          id: 'd-1',
          patientName: 'Paciente Uno',
          rut: '11.111.111-1',
          age: '46',
          bedId: 'R1',
          bedName: 'R1',
          time: '12:45',
          status: 'Vivo',
          dischargeType: 'Domicilio (Habitual)',
          movementDate: '2026-05-14',
          clinicalEpisodeId: 'episode-1',
          originalData,
        }),
      ],
      cma: [],
    });

    const updated = convertDischargeToCmaRecord(
      record,
      'd-1',
      () => 'cma-new',
      RECLASSIFICATION_CONTEXT
    );

    expect(getActiveDischarges(updated.discharges)).toEqual([]);
    expect(updated.discharges[0]).toEqual(
      expect.objectContaining({ id: 'd-1', deletedAt: expect.any(String) })
    );
    expect(getActiveCma(updated.cma)).toEqual([
      expect.objectContaining({
        id: 'reclassified:d-1:cma',
        patientName: 'Paciente Uno',
        rut: '11.111.111-1',
        age: '46',
        birthDate: '1980-01-01',
        biologicalSex: 'Femenino',
        originalBedId: 'R1',
        dischargeTime: '12:45',
        clinicalEpisodeId: 'episode-1',
        originalData,
        movementProvenance: {
          source: 'reclassified',
          lineageId: 'd-1',
          classifiedAt: RECLASSIFICATION_CONTEXT.at,
          classifiedBy: RECLASSIFICATION_CONTEXT.actor,
          previousMovementId: 'd-1',
          previousClassification: 'discharge',
        },
      }),
    ]);
  });

  it('does not convert fallecido, fuga or non-home discharges into CMA', () => {
    const record = DataFactory.createMockDailyRecord('2026-05-14', {
      discharges: [
        DataFactory.createMockDischarge({
          id: 'fallecido',
          status: 'Fallecido',
          dischargeType: undefined,
        }),
        DataFactory.createMockDischarge({
          id: 'fuga',
          status: 'Vivo',
          dischargeType: 'Fuga',
        }),
        DataFactory.createMockDischarge({
          id: 'otra',
          status: 'Vivo',
          dischargeType: 'Otra',
        }),
      ],
      cma: [],
    });

    expect(convertDischargeToCmaRecord(record, 'fallecido', () => 'cma-1')).toBe(record);
    expect(convertDischargeToCmaRecord(record, 'fuga', () => 'cma-2')).toBe(record);
    expect(convertDischargeToCmaRecord(record, 'otra', () => 'cma-3')).toBe(record);
  });

  it('converts a home discharge into a transfer without restoring the bed', () => {
    const originalData = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: 'episode-transfer',
    });
    const record = DataFactory.createMockDailyRecord('2026-05-14', {
      beds: {},
      discharges: [
        DataFactory.createMockDischarge({
          id: 'd-transfer',
          bedId: 'R1',
          status: 'Vivo',
          dischargeType: 'Domicilio (Habitual)',
          movementDate: '2026-05-14',
          time: '14:20',
          originalData,
          clinicalEpisodeId: 'episode-transfer',
        }),
      ],
      transfers: [],
    });

    const updated = convertDischargeToTransferRecord(
      record,
      'd-transfer',
      () => 't-new',
      RECLASSIFICATION_CONTEXT
    );

    expect(updated.beds).toEqual({});
    expect(getActiveDischarges(updated.discharges)).toEqual([]);
    expect(getActiveTransfers(updated.transfers)).toEqual([
      expect.objectContaining({
        id: 'reclassified:d-transfer:transfer',
        bedId: 'R1',
        time: '14:20',
        evacuationMethod: '',
        receivingCenter: '',
        clinicalEpisodeId: 'episode-transfer',
      }),
    ]);
  });

  it('converts an active CMA into a home discharge while tombstoning the original movement', () => {
    const originalData = DataFactory.createMockPatient('R2', {
      patientName: 'Paciente Dos',
      rut: '22.222.222-2',
      clinicalEpisodeId: 'episode-2',
    });
    const record = DataFactory.createMockDailyRecord('2026-05-14', {
      discharges: [],
      cma: [
        DataFactory.createMockCMA({
          id: 'cma-1',
          patientName: 'Paciente Dos',
          rut: '22.222.222-2',
          age: '55',
          bedName: 'R2',
          originalBedId: 'R2',
          dischargeTime: '16:10',
          clinicalEpisodeId: 'episode-2',
          originalData,
        }),
      ],
    });

    const updated = convertCmaToHomeDischargeRecord(
      record,
      'cma-1',
      () => 'd-new',
      RECLASSIFICATION_CONTEXT
    );

    expect(getActiveCma(updated.cma)).toEqual([]);
    expect(updated.cma[0]).toEqual(
      expect.objectContaining({ id: 'cma-1', deletedAt: expect.any(String) })
    );
    expect(getActiveDischarges(updated.discharges)).toEqual([
      expect.objectContaining({
        id: 'reclassified:cma-1:discharge',
        patientName: 'Paciente Dos',
        rut: '22.222.222-2',
        age: '55',
        bedId: 'R2',
        bedName: 'R2',
        time: '16:10',
        status: 'Vivo',
        dischargeType: 'Domicilio (Habitual)',
        clinicalEpisodeId: 'episode-2',
        originalData,
      }),
    ]);
  });

  it('converts an active CMA into a transfer while preserving episode identity', () => {
    const originalData = DataFactory.createMockPatient('R2', {
      clinicalEpisodeId: 'episode-cma-transfer',
    });
    const record = DataFactory.createMockDailyRecord('2026-05-14', {
      cma: [
        DataFactory.createMockCMA({
          id: 'cma-transfer',
          originalBedId: 'R2',
          dischargeTime: '16:30',
          originalData,
          clinicalEpisodeId: 'episode-cma-transfer',
        }),
      ],
      transfers: [],
    });

    const updated = convertCmaToTransferRecord(
      record,
      'cma-transfer',
      () => 't-from-cma',
      RECLASSIFICATION_CONTEXT
    );

    expect(getActiveCma(updated.cma)).toEqual([]);
    expect(getActiveTransfers(updated.transfers)).toEqual([
      expect.objectContaining({
        id: 'reclassified:cma-transfer:transfer',
        bedId: 'R2',
        time: '16:30',
        clinicalEpisodeId: 'episode-cma-transfer',
      }),
    ]);
  });

  it('does not convert a legacy CMA without a source bed into a home discharge', () => {
    const record = DataFactory.createMockDailyRecord('2026-05-14', {
      cma: [DataFactory.createMockCMA({ id: 'cma-without-bed', originalBedId: undefined })],
      discharges: [],
    });

    expect(convertCmaToHomeDischargeRecord(record, 'cma-without-bed', () => 'd-invalid')).toBe(
      record
    );
  });

  it('does not convert a legacy CMA without a source bed into a transfer', () => {
    const record = DataFactory.createMockDailyRecord('2026-05-14', {
      cma: [DataFactory.createMockCMA({ id: 'cma-without-bed', originalBedId: undefined })],
      transfers: [],
    });

    expect(convertCmaToTransferRecord(record, 'cma-without-bed', () => 't-invalid')).toBe(record);
  });

  it('converts a transfer to either home discharge or CMA without duplicating active movements', () => {
    const originalData = DataFactory.createMockPatient('H1C1', {
      clinicalEpisodeId: 'episode-from-transfer',
    });
    const transfer = DataFactory.createMockTransfer({
      id: 't-source',
      bedId: 'H1C1',
      bedName: 'H1C1',
      movementDate: '2026-05-14',
      time: '18:00',
      originalData,
      clinicalEpisodeId: 'episode-from-transfer',
    });
    const record = DataFactory.createMockDailyRecord('2026-05-14', {
      transfers: [transfer],
      discharges: [],
      cma: [],
    });

    const asHome = convertTransferToHomeDischargeRecord(
      record,
      't-source',
      () => 'd-home',
      RECLASSIFICATION_CONTEXT
    );
    expect(getActiveTransfers(asHome.transfers)).toEqual([]);
    expect(getActiveDischarges(asHome.discharges)).toEqual([
      expect.objectContaining({
        id: 'reclassified:t-source:discharge',
        dischargeType: 'Domicilio (Habitual)',
        time: '18:00',
        clinicalEpisodeId: 'episode-from-transfer',
      }),
    ]);

    const asCma = convertTransferToCmaRecord(
      record,
      't-source',
      () => 'cma-from-transfer',
      RECLASSIFICATION_CONTEXT
    );
    expect(getActiveTransfers(asCma.transfers)).toEqual([]);
    expect(getActiveCma(asCma.cma)).toEqual([
      expect.objectContaining({
        id: 'reclassified:t-source:cma',
        originalBedId: 'H1C1',
        dischargeTime: '18:00',
        clinicalEpisodeId: 'episode-from-transfer',
      }),
    ]);
  });

  it('preserves the Eloísa lineage and produces an attributable reclassification summary', () => {
    const discharge = DataFactory.createMockDischarge({
      id: 'rayen-discharge',
      status: 'Vivo',
      dischargeType: 'Domicilio (Habitual)',
      movementProvenance: {
        source: 'gestion_camas',
        lineageId: 'rayen-discharge',
        classifiedAt: '2026-05-14T16:00:00.000Z',
        classifiedBy: 'Eloísa',
        syncRunId: 'sync-run-1',
      },
    });
    const record = DataFactory.createMockDailyRecord('2026-05-14', {
      discharges: [discharge],
      transfers: [],
    });

    const updated = convertDischargeToTransferRecord(
      record,
      discharge.id,
      () => 'unused',
      RECLASSIFICATION_CONTEXT
    );

    expect(getActiveTransfers(updated.transfers)[0]?.movementProvenance).toEqual(
      expect.objectContaining({
        source: 'reclassified',
        lineageId: 'rayen-discharge',
        syncRunId: 'sync-run-1',
        previousMovementId: 'rayen-discharge',
        previousClassification: 'discharge',
      })
    );
    expect(selectMovementReclassificationSummary(updated, discharge.id)).toEqual({
      movementId: 'reclassified:rayen-discharge:transfer',
      previousMovementId: 'rayen-discharge',
      patientName: discharge.patientName,
      rut: discharge.rut,
      from: 'Alta domicilio',
      to: 'Traslado',
      lineageId: 'rayen-discharge',
      clinicalEpisodeId: discharge.clinicalEpisodeId,
    });
  });

  it('uses a deterministic target id so a concurrent retry cannot append the same conversion twice', () => {
    const discharge = DataFactory.createMockDischarge({
      id: 'concurrent-discharge',
      status: 'Vivo',
      dischargeType: 'Domicilio (Habitual)',
    });
    const record = DataFactory.createMockDailyRecord('2026-05-14', {
      discharges: [discharge],
      cma: [],
    });
    const first = convertDischargeToCmaRecord(
      record,
      discharge.id,
      () => 'random-1',
      RECLASSIFICATION_CONTEXT
    );
    const retryBase = { ...record, cma: first.cma };

    const retried = convertDischargeToCmaRecord(
      retryBase,
      discharge.id,
      () => 'random-2',
      RECLASSIFICATION_CONTEXT
    );

    expect(getActiveCma(retried.cma)).toHaveLength(1);
    expect(getActiveCma(retried.cma)[0]?.id).toBe('reclassified:concurrent-discharge:cma');
  });
});
