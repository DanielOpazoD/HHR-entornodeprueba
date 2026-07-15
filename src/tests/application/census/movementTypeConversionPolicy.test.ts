import { describe, expect, it } from 'vitest';

import {
  convertCmaToHomeDischargeRecord,
  convertCmaToTransferRecord,
  convertDischargeToCmaRecord,
  convertDischargeToTransferRecord,
  convertTransferToCmaRecord,
  convertTransferToHomeDischargeRecord,
} from '@/application/census/movementTypeConversionPolicy';
import {
  getActiveCma,
  getActiveDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';
import { DataFactory } from '@/tests/factories/DataFactory';

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

    const updated = convertDischargeToCmaRecord(record, 'd-1', () => 'cma-new');

    expect(getActiveDischarges(updated.discharges)).toEqual([]);
    expect(updated.discharges[0]).toEqual(
      expect.objectContaining({ id: 'd-1', deletedAt: expect.any(String) })
    );
    expect(getActiveCma(updated.cma)).toEqual([
      expect.objectContaining({
        id: 'cma-new',
        patientName: 'Paciente Uno',
        rut: '11.111.111-1',
        age: '46',
        birthDate: '1980-01-01',
        biologicalSex: 'Femenino',
        originalBedId: 'R1',
        dischargeTime: '12:45',
        clinicalEpisodeId: 'episode-1',
        originalData,
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

    const updated = convertDischargeToTransferRecord(record, 'd-transfer', () => 't-new');

    expect(updated.beds).toEqual({});
    expect(getActiveDischarges(updated.discharges)).toEqual([]);
    expect(getActiveTransfers(updated.transfers)).toEqual([
      expect.objectContaining({
        id: 't-new',
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

    const updated = convertCmaToHomeDischargeRecord(record, 'cma-1', () => 'd-new');

    expect(getActiveCma(updated.cma)).toEqual([]);
    expect(updated.cma[0]).toEqual(
      expect.objectContaining({ id: 'cma-1', deletedAt: expect.any(String) })
    );
    expect(getActiveDischarges(updated.discharges)).toEqual([
      expect.objectContaining({
        id: 'd-new',
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

    const updated = convertCmaToTransferRecord(record, 'cma-transfer', () => 't-from-cma');

    expect(getActiveCma(updated.cma)).toEqual([]);
    expect(getActiveTransfers(updated.transfers)).toEqual([
      expect.objectContaining({
        id: 't-from-cma',
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

    const asHome = convertTransferToHomeDischargeRecord(record, 't-source', () => 'd-home');
    expect(getActiveTransfers(asHome.transfers)).toEqual([]);
    expect(getActiveDischarges(asHome.discharges)).toEqual([
      expect.objectContaining({
        id: 'd-home',
        dischargeType: 'Domicilio (Habitual)',
        time: '18:00',
        clinicalEpisodeId: 'episode-from-transfer',
      }),
    ]);

    const asCma = convertTransferToCmaRecord(record, 't-source', () => 'cma-from-transfer');
    expect(getActiveTransfers(asCma.transfers)).toEqual([]);
    expect(getActiveCma(asCma.cma)).toEqual([
      expect.objectContaining({
        id: 'cma-from-transfer',
        originalBedId: 'H1C1',
        dischargeTime: '18:00',
        clinicalEpisodeId: 'episode-from-transfer',
      }),
    ]);
  });
});
