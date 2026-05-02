import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { HospitalizationEvent } from '@/types/domain/patientMaster';

const {
  getAllRecords,
  getAllRecordsFromFirestore,
  getRecordsRangeFromFirestore,
  saveRecords,
  isFirestoreEnabled,
} = vi.hoisted(() => ({
  getAllRecords: vi.fn(),
  getAllRecordsFromFirestore: vi.fn(),
  getRecordsRangeFromFirestore: vi.fn(),
  saveRecords: vi.fn(),
  isFirestoreEnabled: vi.fn(),
}));

vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getAllRecords,
  saveRecords,
}));

vi.mock('@/services/storage/firestore', () => ({
  getAllRecordsFromFirestore,
  getRecordsRangeFromFirestore,
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled,
}));

import { getPatientMovementHistory } from '@/services/patient/patientHistoryService';

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
    vi.clearAllMocks();
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
            rut: '8.932.066-6',
            patientName: 'Ines Riroroko Leiva',
            admissionDate: '2026-04-07',
            admissionTime: '09:00',
            admissionOrigin: 'Urgencias',
          } as never,
        },
      }),
    });

    getRecordsRangeFromFirestore.mockResolvedValue([
      buildRecord('2026-04-15', {
        discharges: [
          {
            id: 'd-1',
            rut: '8.932.066-6',
            patientName: 'Ines Riroroko Leiva',
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

    const history = await getPatientMovementHistory('8.932.066-6', {
      hospitalizationHints,
      lastAdmission: '2026-04-07',
    });

    expect(getRecordsRangeFromFirestore).toHaveBeenCalledWith('2026-04-07', '2026-04-18');
    expect(saveRecords).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ date: '2026-04-15' })])
    );
    expect(history).toEqual(
      expect.objectContaining({
        firstSeen: '2026-04-07',
        lastSeen: '2026-04-15',
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

    await getPatientMovementHistory('8.932.066-6', {
      hospitalizationHints,
      lastAdmission: '2026-04-07',
    });

    expect(getRecordsRangeFromFirestore).toHaveBeenCalledWith('2026-04-07', '2026-04-15');
  });

  it('hydrates remote records without hospitalization hints when local history has no patient matches', async () => {
    getAllRecords.mockResolvedValue({});
    getAllRecordsFromFirestore.mockResolvedValue({
      '2026-02-02': buildRecord('2026-02-02', {
        beds: {
          R3: {
            rut: '18.781.542-8',
            patientName: 'Tipanie Carossi Pakomio',
            admissionDate: '2026-02-02',
            admissionTime: '14:00',
            admissionOrigin: 'Urgencias',
          } as never,
        },
      }),
      '2026-02-05': buildRecord('2026-02-05', {
        discharges: [
          {
            id: 'd-tipanie',
            rut: '18.781.542-8',
            patientName: 'Tipanie Carossi Pakomio',
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

    const history = await getPatientMovementHistory('18.781.542-8');

    expect(getRecordsRangeFromFirestore).not.toHaveBeenCalled();
    expect(getAllRecordsFromFirestore).toHaveBeenCalledTimes(1);
    expect(saveRecords).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ date: '2026-02-02' }),
        expect.objectContaining({ date: '2026-02-05' }),
      ])
    );
    expect(history?.movements.map(movement => movement.type)).toEqual(['admission', 'discharge']);
    expect(history).toEqual(
      expect.objectContaining({
        patientName: 'Tipanie Carossi Pakomio',
        firstSeen: '2026-02-02',
        lastSeen: '2026-02-05',
      })
    );
  });

  it('keeps separate hospitalizations and does not turn readmission into a bed change', async () => {
    getAllRecords.mockResolvedValue({});
    getAllRecordsFromFirestore.mockResolvedValue({
      '2026-03-26': buildRecord('2026-03-26', {
        beds: {
          H3C1: {
            rut: '18.781.542-8',
            patientName: 'Tipanie Carossi Pakomio',
            admissionDate: '2026-03-26',
            admissionTime: '14:00',
            admissionOrigin: 'Urgencias',
          } as never,
        },
      }),
      '2026-04-06': buildRecord('2026-04-06', {
        discharges: [
          {
            id: 'd-tipanie-1',
            rut: '18.781.542-8',
            patientName: 'Tipanie Carossi Pakomio',
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
            rut: '18.781.542-8',
            patientName: 'Tipanie Carossi Pakomio',
            admissionDate: '2026-04-12',
            admissionTime: '09:00',
            admissionOrigin: 'Urgencias',
          } as never,
        },
      }),
      '2026-04-24': buildRecord('2026-04-24', {
        discharges: [
          {
            id: 'd-tipanie-2',
            rut: '18.781.542-8',
            patientName: 'Tipanie Carossi Pakomio',
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

    const history = await getPatientMovementHistory('18.781.542-8', {
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

    expect(getAllRecordsFromFirestore).toHaveBeenCalledTimes(1);
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

  it('returns null for invalid identifiers and skips all storage lookups', async () => {
    await expect(getPatientMovementHistory('')).resolves.toBeNull();
    await expect(getPatientMovementHistory('12')).resolves.toBeNull();

    expect(getAllRecords).not.toHaveBeenCalled();
    expect(getRecordsRangeFromFirestore).not.toHaveBeenCalled();
  });

  it('uses only local history when firestore sync is disabled', async () => {
    isFirestoreEnabled.mockReturnValue(false);
    getAllRecords.mockResolvedValue({
      '2026-04-07': buildRecord('2026-04-07', {
        beds: {
          H1C1: {
            rut: '8.932.066-6',
            patientName: 'Ines Riroroko Leiva',
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
            rut: '8.932.066-6',
            patientName: 'Ines Riroroko Leiva',
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

    const history = await getPatientMovementHistory('8.932.066-6');

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
    getAllRecords.mockResolvedValue({
      '2026-04-07': buildRecord('2026-04-07', {
        beds: {
          H1C1: {
            rut: '8.932.066-6',
            patientName: 'Ines Riroroko Leiva',
            admissionDate: '2026-04-07',
            admissionTime: '09:00',
          } as never,
        },
      }),
    });
    getRecordsRangeFromFirestore.mockRejectedValue(new Error('offline'));

    const history = await getPatientMovementHistory('8.932.066-6', {
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
    expect(saveRecords).not.toHaveBeenCalled();
  });

  it('tracks crib admissions and crib moves as part of the current hospitalization', async () => {
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
