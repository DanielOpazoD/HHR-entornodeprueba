import type { DailyRecord } from '@/types/domain/dailyRecord';

export const createClinicalSyncEmptyBed = (bedId: string): DailyRecord['beds'][string] =>
  ({
    bedId,
    patientName: '',
    rut: '',
    age: '',
    pathology: '',
    specialty: '',
    status: 'Estable',
    admissionDate: '',
    devices: [],
  }) as unknown as DailyRecord['beds'][string];

export const createClinicalSyncPatient = (
  bedId: string,
  overrides: Partial<DailyRecord['beds'][string]> = {}
): DailyRecord['beds'][string] =>
  ({
    bedId,
    patientName: 'Paciente Censo',
    rut: '11.111.111-1',
    age: '40a',
    pathology: 'Diagnostico base',
    specialty: 'Medicina',
    status: 'Estable',
    admissionDate: '2026-07-01',
    clinicalEpisodeId: 'episode-censo-1',
    devices: [],
    ...overrides,
  }) as unknown as DailyRecord['beds'][string];

export const createClinicalSyncCensusRecord = (
  overrides: Partial<DailyRecord> = {}
): DailyRecord => ({
  date: '2026-07-03',
  beds: {
    R1: createClinicalSyncPatient('R1'),
    R2: createClinicalSyncEmptyBed('R2'),
    NEO1: createClinicalSyncEmptyBed('NEO1'),
  },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-07-03T08:00:00.000Z',
  nurses: [],
  activeExtraBeds: [],
  ...overrides,
});
