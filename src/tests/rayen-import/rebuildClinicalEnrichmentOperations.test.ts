import { describe, expect, it } from 'vitest';
import { rebuildClinicalEnrichmentOperations } from '@/features/rayen-import/domain/rebuildClinicalEnrichmentOperations';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { ClinicalFillPatchOperation } from '@/features/rayen-import';

const patient = (bedId: string, total: number, heartRate = 70) => ({
  bedId,
  clinicalEpisodeId: 'episode-1',
  evaluationScores: { braden: { total } },
  vitalSigns: { heartRate },
});

const record = (bedId: string, total: number, heartRate = 70): DailyRecord =>
  ({
    date: '2026-08-02',
    beds: { [bedId]: patient(bedId, total, heartRate) },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-08-02T10:00:00.000Z',
  }) as unknown as DailyRecord;

const operation: ClinicalFillPatchOperation = {
  target: {
    censusDate: '2026-08-02',
    bedId: 'R1',
    clinicalEpisodeId: 'episode-1',
  },
  patch: { 'beds.R1.evaluationScores': { braden: { total: 18 } } },
  clinicalFieldCount: 1,
};

describe('rebuildClinicalEnrichmentOperations', () => {
  it('rebinds an unchanged episode to its current bed', () => {
    const rebuilt = rebuildClinicalEnrichmentOperations({
      baseRecord: record('R1', 16),
      currentRecord: record('R2', 16),
      operations: [operation],
    });

    expect(rebuilt).toEqual([
      expect.objectContaining({
        target: expect.objectContaining({ bedId: 'R2', clinicalEpisodeId: 'episode-1' }),
        patch: { 'beds.R2.evaluationScores': { braden: { total: 18 } } },
      }),
    ]);
  });

  it('drops a field that already has the desired authoritative value', () => {
    expect(
      rebuildClinicalEnrichmentOperations({
        baseRecord: record('R1', 16),
        currentRecord: record('R1', 18),
        operations: [operation],
      })
    ).toEqual([]);
  });

  it('fails closed when a target field received a different concurrent value', () => {
    expect(() =>
      rebuildClinicalEnrichmentOperations({
        baseRecord: record('R1', 16),
        currentRecord: record('R1', 17),
        operations: [operation],
      })
    ).toThrow('cambió mientras se preparaba');
  });

  it('coalesces separate fields for the same episode during a conflict rebuild', () => {
    const vitalOperation: ClinicalFillPatchOperation = {
      target: operation.target,
      patch: { 'beds.R1.vitalSigns': { heartRate: 82 } },
      clinicalFieldCount: 1,
    };

    expect(
      rebuildClinicalEnrichmentOperations({
        baseRecord: record('R1', 16, 70),
        currentRecord: record('R2', 16, 70),
        operations: [operation, vitalOperation],
      })
    ).toEqual([
      expect.objectContaining({
        target: expect.objectContaining({ bedId: 'R2', clinicalEpisodeId: 'episode-1' }),
        clinicalFieldCount: 2,
        patch: {
          'beds.R2.evaluationScores': { braden: { total: 18 } },
          'beds.R2.vitalSigns': { heartRate: 82 },
        },
      }),
    ]);
  });
});
