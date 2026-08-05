import { vi } from 'vitest';
import type { ClinicalFillPatchOperation } from '@/features/rayen-import';
import type { RayenClinicalEnrichmentBatchPayload } from '@/features/rayen-import/bridge/rayenClinicalEnrichmentBatchClient';
import type { DailyRecord } from '@/types/domain/dailyRecord';

export const record = {
  date: '2026-07-28',
  lastUpdated: '2026-07-28T10:00:00.000Z',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  meta: { revision: 7 },
} as unknown as DailyRecord;

export const operations: ClinicalFillPatchOperation[] = [
  {
    target: {
      censusDate: '2026-07-28',
      bedId: 'H2C1',
      clinicalEpisodeId: 'episode-1',
    },
    patch: {
      'beds.H2C1.evaluationScores': { braden: { total: 17 } },
      'beds.H2C1.clinicalSyncCheckpoint': { version: 1, sources: {} },
    },
  },
  {
    target: {
      censusDate: '2026-07-28',
      bedId: 'H2C2',
      clinicalEpisodeId: 'episode-2',
    },
    patch: { 'beds.H2C2.vitalSigns': { systolic: 120 } },
  },
];

export const createDependencies = () => ({
  applyPatch: vi.fn().mockResolvedValue(undefined),
  refreshRecord: vi.fn().mockResolvedValue(record),
  invoke: vi.fn().mockImplementation(async (payload: RayenClinicalEnrichmentBatchPayload) => ({
    success: true,
    authorityStatus: 'ok' as const,
    date: payload.date,
    mode: payload.mode,
    targetCount: new Set(
      [...payload.patches, ...(payload.checkpoints ?? [])].map(
        target => `${target.bedId}|${target.clinicalCrib ? 'crib' : 'patient'}`
      )
    ).size,
    fieldCount:
      payload.patches.reduce((total, item) => total + Object.keys(item.fields).length, 0) +
      (payload.checkpoints?.length ?? 0),
    resultParity: 'matched' as const,
    patientWrites: 1,
    historySnapshots: Number(payload.patches.length > 0),
  })),
  createMutationId: vi.fn(() => 'mutation-fixed'),
});
