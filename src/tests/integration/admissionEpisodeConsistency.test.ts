// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DischargeData } from '@/types/domain/movements';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import { calculateMinsalStats } from '@/features/analytics/services/minsalStatsCalculator';

const {
  mockGetAvailableDates,
  mockGetForDate,
  mockSaveDetailed,
  mockLogAuditEvent,
  recordsByDate,
} = vi.hoisted(() => {
  const recordsByDate = new Map<string, DailyRecord>();

  return {
    mockGetAvailableDates: vi.fn(),
    mockGetForDate: vi.fn(),
    mockSaveDetailed: vi.fn(),
    mockLogAuditEvent: vi.fn(),
    recordsByDate,
  };
});

vi.mock('@/services/repositories/dailyRecordRepositoryReadService', () => ({
  getAvailableDates: mockGetAvailableDates,
  getForDate: mockGetForDate,
}));

vi.mock('@/services/repositories/dailyRecordRepositoryWriteService', () => ({
  saveDetailed: mockSaveDetailed,
}));

vi.mock('@/services/admin/auditService', () => ({
  logAuditEvent: mockLogAuditEvent,
}));

vi.mock('@/services/admin/utils/auditUtils', () => ({
  getCurrentUserEmail: () => 'admin@hanga.roa',
}));

import {
  auditAdmissionDateBackfill,
  applyAdmissionDateBackfill,
} from '@/features/admin/services/admissionDateBackfillService';

const BED_ID = 'R1';
const ROUTINE_RUT = '11.111.111-1';

const buildOccupiedBed = (admissionDate: string, patientName = 'Paciente'): PatientData =>
  ({
    bedId: BED_ID,
    bedName: BED_ID,
    patientName,
    rut: ROUTINE_RUT,
    pathology: 'Dx',
    specialty: Specialty.CIRUGIA,
    status: PatientStatus.ESTABLE,
    admissionDate,
    admissionTime: '08:00',
    age: '45',
    bedMode: 'Cama',
    hasCompanionCrib: false,
    isBlocked: false,
    devices: [],
    hasWristband: true,
    surgicalComplication: false,
    isUPC: false,
  }) as PatientData;

const buildEmptyBed = (): PatientData =>
  ({
    bedId: BED_ID,
    bedName: BED_ID,
    patientName: '',
    rut: '',
    pathology: '',
    specialty: Specialty.EMPTY,
    status: PatientStatus.EMPTY,
    admissionDate: '',
    admissionTime: '',
    age: '',
    bedMode: 'Cama',
    hasCompanionCrib: false,
    isBlocked: false,
    devices: [],
    hasWristband: true,
    surgicalComplication: false,
    isUPC: false,
  }) as PatientData;

const buildRecord = (
  date: string,
  bed: PatientData,
  discharges: DischargeData[] = []
): DailyRecord =>
  ({
    date,
    beds: {
      [BED_ID]: bed,
    },
    discharges,
    transfers: [],
    cma: [],
    lastUpdated: `${date}T00:00:00.000Z`,
    nurses: [],
    activeExtraBeds: [],
  }) as DailyRecord;

const buildDischarge = (admissionDate: string, date: string): DischargeData =>
  ({
    id: `discharge-${date}`,
    bedName: BED_ID,
    bedId: BED_ID,
    bedType: 'Cama',
    patientName: 'Paciente',
    rut: ROUTINE_RUT,
    diagnosis: 'Dx',
    time: '12:00',
    status: 'Vivo',
    originalData: {
      ...buildOccupiedBed(admissionDate),
    },
  }) as DischargeData;

const resetRepositoryMocks = (): void => {
  recordsByDate.clear();
  mockGetAvailableDates.mockImplementation(async () => Array.from(recordsByDate.keys()).sort());
  mockGetForDate.mockImplementation(async (date: string) => recordsByDate.get(date) || null);
  mockSaveDetailed.mockImplementation(async (record: DailyRecord) => {
    recordsByDate.set(record.date, record);
  });
  mockLogAuditEvent.mockResolvedValue(undefined);
};

describe('admission episode consistency integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRepositoryMocks();
  });

  it('keeps the same corrected admission date aligned across census, statistics and backfill', async () => {
    recordsByDate.set('2026-03-01', buildRecord('2026-03-01', buildOccupiedBed('2025-01-01')));
    recordsByDate.set('2026-03-02', buildRecord('2026-03-02', buildOccupiedBed('2026-03-01')));
    recordsByDate.set(
      '2026-03-03',
      buildRecord('2026-03-03', buildEmptyBed(), [buildDischarge('2025-01-01', '2026-03-03')])
    );

    const audit = await auditAdmissionDateBackfill();
    expect(audit).toMatchObject({
      outcome: 'repaired',
      correctionCount: 3,
      touchedRecords: 3,
    });
    expect(audit.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: '2026-03-01',
          firstSeenDate: '2026-03-01',
        }),
        expect.objectContaining({
          date: '2026-03-03',
          firstSeenDate: '2026-03-01',
        }),
      ])
    );

    const applied = await applyAdmissionDateBackfill();
    expect(applied).toMatchObject({
      outcome: 'repaired',
      appliedRecords: 3,
      failedRecords: 0,
    });

    const stats = calculateMinsalStats(
      Array.from(recordsByDate.values()),
      '2026-03-01',
      '2026-03-03'
    );
    const cirugia = stats.porEspecialidad.find(item => item.specialty === Specialty.CIRUGIA);

    expect(cirugia?.egresos).toBe(1);
    expect(cirugia?.promedioDiasEstada).toBe(2);
    expect(cirugia?.egresosList?.[0]?.admissionDate).toBe('2026-03-01');
    expect(recordsByDate.get('2026-03-01')?.beds[BED_ID].admissionDate).toBe('2026-03-01');
    expect(recordsByDate.get('2026-03-03')?.discharges[0]?.originalData?.admissionDate).toBe(
      '2026-03-01'
    );
  });

  it('keeps two episodes separate when the same RUT is rehospitalized later in the same month', async () => {
    recordsByDate.set('2026-03-01', buildRecord('2026-03-01', buildOccupiedBed('2025-01-01')));
    recordsByDate.set('2026-03-02', buildRecord('2026-03-02', buildOccupiedBed('2025-01-01')));
    recordsByDate.set(
      '2026-03-03',
      buildRecord('2026-03-03', buildEmptyBed(), [buildDischarge('2025-01-01', '2026-03-03')])
    );
    recordsByDate.set('2026-03-18', buildRecord('2026-03-18', buildOccupiedBed('2025-01-01')));
    recordsByDate.set(
      '2026-03-19',
      buildRecord('2026-03-19', buildEmptyBed(), [buildDischarge('2025-01-01', '2026-03-19')])
    );

    const audit = await auditAdmissionDateBackfill();
    expect(audit.correctionCount).toBeGreaterThanOrEqual(3);
    expect(audit.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          firstSeenDate: '2026-03-01',
        }),
        expect.objectContaining({
          firstSeenDate: '2026-03-18',
        }),
      ])
    );

    await applyAdmissionDateBackfill();

    const stats = calculateMinsalStats(
      Array.from(recordsByDate.values()),
      '2026-03-01',
      '2026-03-31'
    );
    const cirugia = stats.porEspecialidad.find(item => item.specialty === Specialty.CIRUGIA);

    expect(cirugia?.egresos).toBe(2);
    expect(cirugia?.promedioDiasEstadaMinima).toBe(1);
    expect(cirugia?.promedioDiasEstadaMaxima).toBe(2);
    expect(cirugia?.egresosList?.[0]?.admissionDate).toBe('2026-03-01');
    expect(cirugia?.egresosList?.[1]?.admissionDate).toBe('2026-03-18');
  });
});
