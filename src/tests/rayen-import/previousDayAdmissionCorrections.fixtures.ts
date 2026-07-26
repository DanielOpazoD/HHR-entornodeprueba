import { vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';

export const historicalRecord: DailyRecord = {
  date: '2026-07-25',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: 'before',
};

export const motherAndNewbornDiff: CensusImportDiff = {
  admissions: [
    {
      bedId: 'H4C1',
      isCma: false,
      patient: {
        ...EMPTY_PATIENT,
        bedId: 'H4C1',
        patientName: 'Maeva Elisabet Maria Tuki Garcia',
        rut: '17.059.646-3',
        clinicalEpisodeId: '143100',
        admissionDate: '2026-07-26',
        admissionTime: '03:27',
        clinicalCrib: {
          ...EMPTY_PATIENT,
          bedId: 'H4C1',
          bedMode: 'Cuna',
          patientName: 'RN de Maeva Tuki Garcia',
          clinicalEpisodeId: '143101',
          admissionDate: '2026-07-26',
          admissionTime: '05:10',
        },
      },
      source: {
        encounterId: '143100',
        run: '170596463',
        firstGivenName: 'Maeva Elisabet Maria',
        firstFamilyName: 'Tuki',
        secondFamilyName: 'Garcia',
        admissionDatetime: '2026-07-26T03:27:00-06:00',
        room: 'H4',
        bed: 'C1',
        verifiedBedPlacement: {
          source: 'patient-flow-report',
          bedId: 'H4C1',
          changedAt: '2026-07-26T03:27:00',
        },
      },
    },
  ],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 1,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
};

export const repository = {
  getForDate: vi.fn(async (day: string) => (day === '2026-07-25' ? historicalRecord : null)),
} as unknown as DailyRecordRepositoryPort;

export const resetPreviousDayAdmissionFixtures = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-26T12:00:00Z'));
  vi.clearAllMocks();
  vi.mocked(repository.getForDate).mockImplementation(async day =>
    day === '2026-07-25' ? historicalRecord : null
  );
};
