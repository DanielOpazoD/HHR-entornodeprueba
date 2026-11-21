// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { HospitalizationEvent } from '@/types/domain/patientMaster';

const {
  getAllRecords,
  getRecordsRange,
  readServerHistory,
  getRecordsRangeFromFirestore,
  saveRecordsStrict,
  isFirestoreEnabled,
} = vi.hoisted(() => ({
  getAllRecords: vi.fn(),
  getRecordsRange: vi.fn(),
  readServerHistory: vi.fn(),
  getRecordsRangeFromFirestore: vi.fn(),
  saveRecordsStrict: vi.fn(),
  isFirestoreEnabled: vi.fn(),
}));

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getAllRecords,
  getRecordsRange,
  saveRecordsStrict,
}));

vi.mock('@/services/storage/firestore', () => ({
  getRecordPagesFromFirestore: async function* () {
    yield Object.values(await readServerHistory({ requireServer: true }));
  },
  getRecordsRangeFromFirestore,
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled,
}));

import { getPatientMovementHistoryDetailed } from '@/services/patient/patientHistoryService';

const getPatientMovementHistory = async (
  ...args: Parameters<typeof getPatientMovementHistoryDetailed>
) => (await getPatientMovementHistoryDetailed(...args)).history;

const buildRecord = (date: string, overrides: Partial<DailyRecord> = {}): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T08:00:00.000Z`,
    nurses: [],
    activeExtraBeds: [],
    ...overrides,
  }) as DailyRecord;

describe('patientHistoryService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-18T12:00:00.000Z'));
    isFirestoreEnabled.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates the latest hospitalization from Firestore when local history is missing the discharge', async () => {
    const hospitalizationHints: HospitalizationEvent[] = [
      {
        id: 'ing-1',
        type: 'Ingreso',
        date: '2026-04-07',
        diagnosis: 'Insuficiencia cardíaca',
        bedName: 'H1C1',
      },
    ];

    getAllRecords.mockResolvedValue({
      '2026-04-07': buildRecord('2026-04-07', {
        beds: {
          H1C1: {
            rut: '1.000.122-6',
            patientName: 'Isut Rebolesu Litus',
            admissionDate: '2026-04-07',
            admissionTime: '09:00',
            admissionOrigin: 'Urgencias',
          } as never,
        },
      }),
    });

    getRecordsRangeFromFirestore.mockResolvedValue([
      buildRecord('2026-04-07', {
        beds: { H1C1: { rut: '1.000.122-6', admissionDate: '2026-04-07' } as never },
      }),
      buildRecord('2026-04-15', {
        discharges: [
          {
            id: 'd-1',
            rut: '1.000.122-6',
            patientName: 'Isut Rebolesu Litus',
            bedId: 'H1C1',
            bedName: 'H1C1',
            bedType: 'MEDIA',
            diagnosis: 'Insuficiencia cardíaca',
            dischargeType: 'Domicilio (Habitual)',
            time: '11:30',
            status: 'Vivo',
          },
        ],
      }),
    ]);

    const history = await getPatientMovementHistory('1.000.122-6', {
      hospitalizationHints,
      lastAdmission: '2026-04-07',
    });

    expect(getRecordsRangeFromFirestore).toHaveBeenCalledWith('2026-04-07', '2026-04-18', {
      requireServer: true,
    });
    expect(saveRecordsStrict).not.toHaveBeenCalled();
    expect(history).toEqual(
      expect.objectContaining({
        firstSeen: '2026-04-07',
        lastSeen: '2026-04-15',
        totalDays: 8,
      })
    );
    expect(history?.movements.map(movement => movement.type)).toEqual(['admission', 'discharge']);
    expect(history?.movements[1]).toEqual(
      expect.objectContaining({
        date: '2026-04-15',
        type: 'discharge',
        details: 'Domicilio (Habitual)',
      })
    );
  });

  it('uses closing hospitalization hints to cap the remote range without requiring lastDischarge', async () => {
    const hospitalizationHints: HospitalizationEvent[] = [
      {
        id: 'ing-1',
        type: 'Ingreso',
        date: '2026-04-07',
        diagnosis: 'Insuficiencia cardíaca',
        bedName: 'H1C1',
      },
      {
        id: 'eg-1',
        type: 'Egreso',
        date: '2026-04-15',
        diagnosis: 'Insuficiencia cardíaca',
        bedName: 'H1C1',
      },
    ];

    getAllRecords.mockResolvedValue({});
    getRecordsRangeFromFirestore.mockResolvedValue([]);

    await getPatientMovementHistory('1.000.122-6', {
      hospitalizationHints,
      lastAdmission: '2026-04-07',
    });

    expect(getRecordsRangeFromFirestore).toHaveBeenCalledWith('2026-04-07', '2026-04-15', {
      requireServer: true,
    });
  });

  it('hydrates remote records without hospitalization hints when local history has no patient matches', async () => {
    getAllRecords.mockResolvedValue({});
    readServerHistory.mockResolvedValue({
      '2026-02-02': buildRecord('2026-02-02', {
        beds: {
          R3: {
            rut: '10.000.109-8',
            patientName: 'Tisigef Cunonoc Pagorim',
            admissionDate: '2026-02-02',
            admissionTime: '14:00',
            admissionOrigin: 'Urgencias',
          } as never,
        },
      }),
      '2026-02-05': buildRecord('2026-02-05', {
        discharges: [
          {
            id: 'd-tisigef',
            rut: '10.000.109-8',
            patientName: 'Tisigef Cunonoc Pagorim',
            bedId: 'R3',
            bedName: 'R3',
            bedType: 'MEDIA',
            diagnosis: 'ACV',
            dischargeType: 'Domicilio (Habitual)',
            time: '10:00',
            status: 'Vivo',
          },
        ],
      }),
    });

    const history = await getPatientMovementHistory('10.000.109-8');

    expect(getRecordsRangeFromFirestore).not.toHaveBeenCalled();
    expect(readServerHistory).toHaveBeenCalledTimes(1);
    expect(saveRecordsStrict).not.toHaveBeenCalled();
    expect(history?.movements.map(movement => movement.type)).toEqual(['admission', 'discharge']);
    expect(history).toEqual(
      expect.objectContaining({
        patientName: 'Tisigef Cunonoc Pagorim',
        firstSeen: '2026-02-02',
        lastSeen: '2026-02-05',
      })
    );
  });

  it('keeps separate hospitalizations and does not turn readmission into a bed change', async () => {
    getAllRecords.mockResolvedValue({});
    readServerHistory.mockResolvedValue({
      '2026-03-26': buildRecord('2026-03-26', {
        beds: {
          H3C1: {
            rut: '10.000.109-8',
            patientName: 'Tisigef Cunonoc Pagorim',
            admissionDate: '2026-03-26',
            admissionTime: '14:00',
            admissionOrigin: 'Urgencias',
          } as never,
        },
      }),
      '2026-04-06': buildRecord('2026-04-06', {
        discharges: [
          {
            id: 'd-tisigef-1',
            rut: '10.000.109-8',
            patientName: 'Tisigef Cunonoc Pagorim',
            bedId: 'H4C1',
            bedName: 'H4C1',
            bedType: 'MEDIA',
            diagnosis: 'ACV',
            dischargeType: 'Domicilio (Habitual)',
            time: '10:00',
            status: 'Vivo',
          },
        ],
      }),
      '2026-04-12': buildRecord('2026-04-12', {
        beds: {
          H2C2: {
            rut: '10.000.109-8',
            patientName: 'Tisigef Cunonoc Pagorim',
            admissionDate: '2026-04-12',
            admissionTime: '09:00',
            admissionOrigin: 'Urgencias',
          } as never,
        },
      }),
      '2026-04-24': buildRecord('2026-04-24', {
        discharges: [
          {
            id: 'd-tisigef-2',
            rut: '10.000.109-8',
            patientName: 'Tisigef Cunonoc Pagorim',
            bedId: 'H2C2',
            bedName: 'H2C2',
            bedType: 'MEDIA',
            diagnosis: 'ACV',
            dischargeType: 'Domicilio (Habitual)',
            time: '11:00',
            status: 'Vivo',
          },
        ],
      }),
    });

    const history = await getPatientMovementHistory('10.000.109-8', {
      forceFullRemoteHydration: true,
      hospitalizationHints: [
        {
          id: 'latest',
          type: 'Ingreso',
          date: '2026-04-12',
          diagnosis: 'ACV',
          bedName: 'H2C2',
        },
      ],
    });

    expect(readServerHistory).toHaveBeenCalledTimes(1);
    expect(getRecordsRangeFromFirestore).not.toHaveBeenCalled();
    expect(
      history?.movements.map(movement => `${movement.date}:${movement.type}:${movement.bedId}`)
    ).toEqual([
      '2026-03-26:admission:H3C1',
      '2026-04-06:discharge:H4C1',
      '2026-04-12:admission:H2C2',
      '2026-04-24:discharge:H2C2',
    ]);
    expect(history?.movements).not.toContainEqual(
      expect.objectContaining({
        date: '2026-04-12',
        type: 'internal_move',
        details: 'Desde cama H4C1',
      })
    );
  });

  it('rejects invalid identifiers and skips all storage lookups', async () => {
    await expect(getPatientMovementHistory('')).rejects.toThrow('Invalid patient identifier');
    await expect(getPatientMovementHistory('12')).rejects.toThrow('Invalid patient identifier');

    expect(getAllRecords).not.toHaveBeenCalled();
    expect(getRecordsRangeFromFirestore).not.toHaveBeenCalled();
  });

  it('uses only local history when firestore sync is disabled', async () => {
    isFirestoreEnabled.mockReturnValue(false);
    getAllRecords.mockResolvedValue({
      '2026-04-07': buildRecord('2026-04-07', {
        beds: {
          H1C1: {
            rut: '1.000.122-6',
            patientName: 'Isut Rebolesu Litus',
            admissionDate: '2026-04-07',
            admissionTime: '09:00',
            admissionOrigin: 'Urgencias',
          } as never,
        },
      }),
      '2026-04-08': buildRecord('2026-04-08', {
        transfers: [
          {
            id: 't-1',
            rut: '1.000.122-6',
            patientName: 'Isut Rebolesu Litus',
            bedId: 'H1C1',
            bedName: 'H1C1',
            bedType: 'MEDIA',
            diagnosis: 'Insuficiencia cardíaca',
            evacuationMethod: 'SAMU',
            receivingCenter: 'Hospital Base',
            time: '15:20',
          },
        ],
      }),
    });

    const history = await getPatientMovementHistory('1.000.122-6');

    expect(getRecordsRangeFromFirestore).not.toHaveBeenCalled();
    expect(history?.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'admission', bedId: 'H1C1' }),
        expect.objectContaining({
          type: 'transfer',
          details: 'SAMU → Hospital Base',
        }),
      ])
    );
  });

  it('falls back to local records when the remote range lookup fails', async () => {
    getRecordsRange.mockResolvedValue([
      buildRecord('2026-04-07', {
        beds: {
          H1C1: {
            rut: '1.000.122-6',
            patientName: 'Isut Rebolesu Litus',
            admissionDate: '2026-04-07',
            admissionTime: '09:00',
          } as never,
        },
      }),
    ]);
    getRecordsRangeFromFirestore.mockRejectedValue(new Error('offline'));

    const history = await getPatientMovementHistory('1.000.122-6', {
      hospitalizationHints: [
        {
          id: 'ing-1',
          type: 'Ingreso',
          date: '2026-04-07',
          diagnosis: 'Insuficiencia cardíaca',
        },
      ],
    });

    expect(history?.movements).toEqual([expect.objectContaining({ type: 'admission' })]);
    expect(saveRecordsStrict).not.toHaveBeenCalled();
  });

  it('tracks crib admissions and crib moves as part of the current hospitalization', async () => {
    isFirestoreEnabled.mockReturnValue(false);
    getAllRecords.mockResolvedValue({
      '2026-04-07': buildRecord('2026-04-07', {
        beds: {
          H1C1: {
            rut: 'madre-1',
            clinicalCrib: {
              rut: '12.345.678-9',
              patientName: 'Recien Nacido',
              admissionDate: '2026-04-07',
            },
          } as never,
        },
      }),
      '2026-04-08': buildRecord('2026-04-08', {
        beds: {
          H2C1: {
            rut: 'madre-1',
            clinicalCrib: {
              rut: '12.345.678-9',
              patientName: 'Recien Nacido',
              admissionDate: '2026-04-07',
            },
          } as never,
        },
      }),
      '2026-04-09': buildRecord('2026-04-09', {
        discharges: [
          {
            id: 'd-crib-1',
            rut: '12.345.678-9',
            patientName: 'Recien Nacido',
            bedId: 'H2C1-cuna',
            bedName: 'Cuna (H2C1)',
            bedType: 'CUNA',
            dischargeType: 'Domicilio',
            status: 'Fallecido',
            time: '10:15',
          } as never,
        ],
      }),
    });

    const history = await getPatientMovementHistory('12.345.678-9');

    expect(history?.movements).toEqual([
      expect.objectContaining({
        type: 'admission',
        bedId: 'H1C1-cuna',
        bedType: 'CUNA',
      }),
      expect.objectContaining({
        type: 'internal_move',
        bedId: 'H2C1-cuna',
        details: 'Desde cama Cuna (H1C1)',
      }),
      expect.objectContaining({
        type: 'discharge',
        details: 'Fallecimiento',
      }),
    ]);
  });
});
