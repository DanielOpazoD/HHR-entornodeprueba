import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const { mockGetAvailableDates, mockGetForDate, mockSaveDetailed, mockLogAuditEvent } = vi.hoisted(
  () => ({
    mockGetAvailableDates: vi.fn(),
    mockGetForDate: vi.fn(),
    mockSaveDetailed: vi.fn(),
    mockLogAuditEvent: vi.fn(),
  })
);

import {
  auditAdmissionDateBackfill,
  applyAdmissionDateBackfill,
} from '@/services/admin/admissionDateBackfillService';

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

describe('admissionDateBackfillService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveDetailed.mockResolvedValue(undefined);
    mockLogAuditEvent.mockResolvedValue(undefined);
  });

  it('audits and repairs stale admission dates using first observed census day', async () => {
    mockGetAvailableDates.mockResolvedValue(['2026-03-02', '2026-03-01']);
    mockGetForDate.mockImplementation(async (date: string) => {
      if (date === '2026-03-01') {
        return {
          date,
          beds: {
            R1: {
              bedId: 'R1',
              bedName: 'R2',
              isBlocked: false,
              bedMode: 'Cama',
              hasCompanionCrib: false,
              patientName: 'Paciente Uno',
              rut: '12.345.678-9',
              age: '45',
              pathology: 'Dx',
              specialty: 'Cirugía',
              status: 'HOSPITALIZADO',
              admissionDate: '2025-03-01',
              devices: [],
              surgicalComplication: false,
              isUPC: false,
              hasWristband: true,
            },
          },
          discharges: [
            {
              id: 'd1',
              bedName: 'R2',
              bedId: 'R1',
              bedType: 'MEDIA',
              patientName: 'Paciente Uno',
              rut: '12.345.678-9',
              diagnosis: 'Dx',
              time: '12:00',
              status: 'Vivo',
              originalData: {
                bedId: 'R1',
                bedName: 'R2',
                isBlocked: false,
                bedMode: 'Cama',
                hasCompanionCrib: false,
                patientName: 'Paciente Uno',
                rut: '12.345.678-9',
                age: '45',
                pathology: 'Dx',
                specialty: 'Cirugía',
                status: 'HOSPITALIZADO',
                admissionDate: '2025-03-01',
                devices: [],
                surgicalComplication: false,
                isUPC: false,
                hasWristband: true,
              },
            },
          ],
          transfers: [],
          cma: [],
          activeExtraBeds: [],
          lastUpdated: '2026-03-01T10:00:00.000Z',
        } as unknown as DailyRecord;
      }

      return {
        date,
        beds: {
          R1: {
            bedId: 'R1',
            bedName: 'R2',
            isBlocked: false,
            bedMode: 'Cama',
            hasCompanionCrib: false,
            patientName: 'Paciente Uno',
            rut: '12.345.678-9',
            age: '45',
            pathology: 'Dx',
            specialty: 'Cirugía',
            status: 'HOSPITALIZADO',
            admissionDate: '2025-03-01',
            devices: [],
            surgicalComplication: false,
            isUPC: false,
            hasWristband: true,
          },
        },
        discharges: [],
        transfers: [],
        cma: [],
        activeExtraBeds: [],
        lastUpdated: '2026-03-02T10:00:00.000Z',
      } as unknown as DailyRecord;
    });

    const audit = await auditAdmissionDateBackfill();

    expect(audit).toMatchObject({
      scannedDays: 2,
      correctionCount: 3,
      touchedRecords: 2,
      outcome: 'repaired',
    });
    expect(audit.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: '2026-03-01',
          scope: 'bed',
          previousAdmissionDate: '2025-03-01',
          suggestedAdmissionDate: '2026-03-01',
        }),
      ])
    );

    const applied = await applyAdmissionDateBackfill();

    expect(applied).toMatchObject({
      appliedRecords: 2,
      failedRecords: 0,
      correctionCount: 3,
      outcome: 'repaired',
    });
    expect(mockSaveDetailed).toHaveBeenCalledTimes(2);
    // A bulk rewrite of past days keeps each day's previous state in history.
    expect(mockSaveDetailed.mock.calls.map(call => call[2])).toEqual([
      { historyPolicy: 'snapshot' },
      { historyPolicy: 'snapshot' },
    ]);
    expect(mockSaveDetailed.mock.calls[0]?.[0]).toMatchObject({
      date: '2026-03-01',
      beds: {
        R1: expect.objectContaining({
          admissionDate: '2026-03-01',
          firstSeenDate: '2026-03-01',
        }),
      },
      discharges: [
        expect.objectContaining({
          originalData: expect.objectContaining({
            admissionDate: '2026-03-01',
            firstSeenDate: '2026-03-01',
          }),
        }),
      ],
    });
    expect(mockSaveDetailed.mock.calls[1]?.[0]).toMatchObject({
      date: '2026-03-02',
      beds: {
        R1: expect.objectContaining({
          admissionDate: '2026-03-02',
          firstSeenDate: '2026-03-02',
        }),
      },
    });
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      'admin@hanga.roa',
      'DATA_ADMISSION_DATES_BACKFILLED',
      'dailyRecord',
      'historical-admission-dates',
      expect.objectContaining({
        correctionCount: 3,
        outcome: 'repaired',
        appliedRecords: 2,
      })
    );
  });
});
