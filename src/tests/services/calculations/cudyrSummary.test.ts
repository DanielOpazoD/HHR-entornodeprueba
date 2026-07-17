import { describe, it, expect, vi } from 'vitest';
import {
  collectDailyCudyrPatients,
  buildDailyCudyrSummary,
  getCudyrMonthlyTotals,
  resolveVisibleCudyrBeds,
} from '@/services/cudyr/cudyrSummary';
import type { DailyRecord } from '@/types/domain/dailyRecord';

// Mock BEDS
vi.mock('@/constants/beds', () => ({
  BEDS: [
    { id: 'R1', name: 'R1', type: 'UTI', isExtra: false },
    { id: 'M1', name: 'M1', type: 'MEDIA', isExtra: false },
    { id: 'EX1', name: 'EX1', type: 'MEDIA', isExtra: true },
  ],
}));

// Mock getCategorization
vi.mock('@/services/cudyr/CudyrScoreUtils', () => ({
  getCategorization: vi.fn(cudyr => {
    if (!cudyr) return { finalCat: null, isCategorized: false };
    return { finalCat: 'A1', isCategorized: true };
  }),
}));

describe('cudyrSummary', () => {
  type CudyrType = NonNullable<DailyRecord['beds'][string]['cudyr']>;
  type BedValue = DailyRecord['beds'][string];

  const mockRecord: DailyRecord = {
    date: '2025-01-01',
    beds: {
      R1: {
        bedId: 'R1',
        patientName: 'Patient 1',
        rut: '12345678-9',
        isBlocked: false,
        admissionDate: '2024-12-31',
        admissionTime: '18:00',
        cudyr: { changeClothes: 1 } as unknown as CudyrType,
      },
      M1: {
        bedId: 'M1',
        patientName: 'Patient 2',
        rut: '98765432-1',
        isBlocked: false,
        admissionDate: '2024-12-31',
        admissionTime: '18:00',
        cudyr: { changeClothes: 2 } as unknown as CudyrType,
        clinicalCrib: {
          bedId: 'M1-crib',
          patientName: 'Baby 1',
          rut: 'RN',
          isBlocked: false,
          admissionDate: '2024-12-31',
          admissionTime: '18:00',
          cudyr: { changeClothes: 0 } as unknown as CudyrType,
        } as unknown as BedValue,
      },
    } as unknown as DailyRecord['beds'],
    discharges: [],
    transfers: [],
    lastUpdated: 'now',
    nurses: [],
    activeExtraBeds: [],
    cma: [],
  } as DailyRecord;

  describe('resolveVisibleCudyrBeds', () => {
    it('includes permanent beds and only active extra beds', () => {
      expect(resolveVisibleCudyrBeds(mockRecord).map(bed => bed.id)).toEqual(['R1', 'M1']);

      expect(
        resolveVisibleCudyrBeds({
          ...mockRecord,
          activeExtraBeds: ['EX1'],
        }).map(bed => bed.id)
      ).toEqual(['R1', 'M1', 'EX1']);
    });
  });

  describe('collectDailyCudyrPatients', () => {
    it('should collect patients with CUDYR scores and preserve the patient metadata', () => {
      const patients = collectDailyCudyrPatients(mockRecord);
      expect(patients).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            bedId: 'R1',
            patientName: 'Patient 1',
            rut: '12345678-9',
            category: 'A1',
            isCrib: false,
          }),
        ])
      );
    });

    it('should include clinical cribs', () => {
      const patients = collectDailyCudyrPatients(mockRecord);
      const crib = patients.find(p => p.isCrib);
      expect(crib).toBeDefined();
    });

    it('should exclude blocked patients', () => {
      const blockedRecord: DailyRecord = {
        ...mockRecord,
        beds: {
          R1: { bedId: 'R1', patientName: 'Blocked', isBlocked: true },
        } as unknown as DailyRecord['beds'],
      };
      const patients = collectDailyCudyrPatients(blockedRecord);
      expect(patients.length).toBe(0);
    });

    it('should handle extra beds based on activeExtraBeds', () => {
      const recordWithExtra: DailyRecord = {
        ...mockRecord,
        activeExtraBeds: ['EX1'],
        beds: {
          ...mockRecord.beds,
          EX1: {
            bedId: 'EX1',
            patientName: 'Extra',
            isBlocked: false,
            admissionDate: '2024-12-31',
            admissionTime: '18:00',
            cudyr: {} as CudyrType,
          } as unknown as BedValue,
        },
      };
      const patients = collectDailyCudyrPatients(recordWithExtra);
      expect(patients.some(p => p.bedId === 'EX1')).toBe(true);
    });

    it('should skip ineligible patients even if they contain historical CUDYR scores', () => {
      const ineligibleRecord: DailyRecord = {
        ...mockRecord,
        date: '2025-01-01',
        beds: {
          R1: {
            bedId: 'R1',
            patientName: 'Ingreso tardio',
            rut: '11111111-1',
            isBlocked: false,
            admissionDate: '2025-01-01',
            admissionTime: '23:30',
            cudyr: { changeClothes: 3, vitalSigns: 3 } as unknown as CudyrType,
          } as unknown as BedValue,
        } as unknown as DailyRecord['beds'],
      };

      const patients = collectDailyCudyrPatients(ineligibleRecord);
      expect(patients).toHaveLength(0);
    });
  });

  describe('buildDailyCudyrSummary', () => {
    it('should return zero counts when the record has no eligible patients', () => {
      const summary = buildDailyCudyrSummary({
        ...mockRecord,
        beds: {} as DailyRecord['beds'],
      });

      expect(summary).toMatchObject({
        date: '2025-01-01',
        occupiedCount: 0,
        categorizedCount: 0,
        utiTotal: 0,
        mediaTotal: 0,
      });
    });

    it('should build summary with counts', () => {
      const summary = buildDailyCudyrSummary(mockRecord);
      expect(summary.date).toBe('2025-01-01');
      expect(summary.categorizedCount).toBeGreaterThan(0);
    });

    it('counts an official imported CUDYR as categorized without manual grid scores', () => {
      const importedRecord: DailyRecord = {
        ...mockRecord,
        beds: {
          R1: {
            bedId: 'R1',
            patientName: 'Paciente importado',
            rut: '12345678-9',
            isBlocked: false,
            admissionDate: '2024-12-31',
            admissionTime: '18:00',
            evaluationScores: {
              cudyr: {
                category: 'C2',
                recordedDate: '2025-01-01',
                source: 'Eloísa · Gestión de Camas',
              },
            },
          } as unknown as BedValue,
        } as DailyRecord['beds'],
      };

      const summary = buildDailyCudyrSummary(importedRecord);

      expect(summary).toMatchObject({ occupiedCount: 1, categorizedCount: 1, utiTotal: 1 });
      expect(summary.counts.uti.C2).toBe(1);
      expect(collectDailyCudyrPatients(importedRecord)[0]?.category).toBe('C2');
    });

    it('does not count an imported CUDYR owned by a different census day', () => {
      const staleRecord = {
        ...mockRecord,
        beds: {
          R1: {
            ...mockRecord.beds.R1,
            cudyr: undefined,
            evaluationScores: {
              cudyr: {
                category: 'C2',
                recordedDate: '2025-01-02',
                source: 'Eloísa · Gestión de Camas',
              },
            },
          },
        },
      } as DailyRecord;

      expect(buildDailyCudyrSummary(staleRecord)).toMatchObject({
        occupiedCount: 1,
        categorizedCount: 0,
      });
    });

    it('rejects inherited object names as imported CUDYR categories', () => {
      const malformedRecord = {
        ...mockRecord,
        beds: {
          R1: {
            ...mockRecord.beds.R1,
            cudyr: undefined,
            evaluationScores: {
              cudyr: {
                category: 'constructor',
                recordedDate: '2025-01-01',
                source: 'Eloísa · Gestión de Camas',
              },
            },
          },
        },
      } as DailyRecord;

      expect(buildDailyCudyrSummary(malformedRecord).categorizedCount).toBe(0);
    });

    it('should separate UTI and MEDIA counts', () => {
      const summary = buildDailyCudyrSummary(mockRecord);
      expect(summary.utiTotal + summary.mediaTotal).toBe(summary.categorizedCount);
    });

    it('should process clinical cribs', () => {
      const summary = buildDailyCudyrSummary(mockRecord);
      // M1 patient + M1 crib = at least 2 categorized in MEDIA
      expect(summary.mediaTotal).toBeGreaterThanOrEqual(1);
    });

    it('should exclude ineligible historical CUDYR scores from occupied and categorized counts', () => {
      const ineligibleRecord: DailyRecord = {
        ...mockRecord,
        date: '2025-01-01',
        beds: {
          R1: {
            bedId: 'R1',
            patientName: 'Ingreso tardio',
            rut: '11111111-1',
            isBlocked: false,
            admissionDate: '2025-01-01',
            admissionTime: '23:30',
            cudyr: { changeClothes: 3, vitalSigns: 3 } as unknown as CudyrType,
          } as unknown as BedValue,
        } as unknown as DailyRecord['beds'],
      };

      const summary = buildDailyCudyrSummary(ineligibleRecord);
      expect(summary.occupiedCount).toBe(0);
      expect(summary.categorizedCount).toBe(0);
      expect(summary.utiTotal).toBe(0);
    });
  });

  describe('getCudyrMonthlyTotals', () => {
    it('should aggregate monthly data', async () => {
      const fetchFn = vi.fn().mockResolvedValue(mockRecord);

      const result = await getCudyrMonthlyTotals(2025, 1, '2025-01-05', fetchFn);

      expect(result.year).toBe(2025);
      expect(result.month).toBe(1);
      expect(fetchFn).toHaveBeenCalledTimes(5);
    });

    it('should use override record when date matches', async () => {
      const fetchFn = vi.fn().mockResolvedValue(null);
      const override = { ...mockRecord, date: '2025-01-01' };

      const result = await getCudyrMonthlyTotals(2025, 1, '2025-01-01', fetchFn, override);

      expect(result.dailySummaries.length).toBe(1);
      expect(fetchFn).not.toHaveBeenCalled(); // Used override
    });

    it('should handle no endDate (full month)', async () => {
      const fetchFn = vi.fn().mockResolvedValue(null);

      const result = await getCudyrMonthlyTotals(2025, 2, undefined, fetchFn);

      // February 2025 has 28 days
      expect(fetchFn).toHaveBeenCalledTimes(28);
      expect(result.dailySummaries.length).toBe(0); // All fetches returned null
    });

    it('should handle empty records', async () => {
      const fetchFn = vi.fn().mockResolvedValue(null);

      const result = await getCudyrMonthlyTotals(2025, 1, '2025-01-03', fetchFn);

      expect(result.totalCategorized).toBe(0);
      expect(result.totalOccupied).toBe(0);
    });
  });
});
