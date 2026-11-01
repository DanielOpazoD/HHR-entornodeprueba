import { describe, expect, it } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import {
  buildAppliedRayenSyncEvent,
  type RayenSyncRun,
} from '@/features/rayen-import/domain/rayenSyncHistory';
import { DailyRecordSchema } from '@/schemas/zod/dailyRecord';
import { buildInitializedDayRecord } from '@/services/repositories/dailyRecordInitializationSupport';

const run: RayenSyncRun = {
  id: 'run-1',
  sourceDate: '2026-07-14',
  startedAt: '2026-07-14T10:00:00.000Z',
  by: 'Operador HHR',
  source: {
    extensionVersion: '0.5.0',
    protocolVersion: 1,
    fichaMedico: 'ready',
    gestionCamas: 'ready',
  },
  policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 3 },
};

const diff = {
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 3,
  summary: {
    admissions: 1,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 3,
  },
} as CensusImportDiff;

describe('a sync history written before the modes were retired', () => {
  it.each(['off', 'shadow'] as const)('still reads a %s event', clinicalBatchMode => {
    const event = {
      ...buildAppliedRayenSyncEvent(run, diff, '2026-07-14T10:01:00.000Z'),
      policy: { mode: 'preview' as const, clinicalBatchMode, revision: 3 },
    };
    const record = DailyRecordSchema.parse({
      ...buildInitializedDayRecord('2026-07-14', null),
      rayenSyncHistory: [event],
    });
    expect(record.rayenSyncHistory).toEqual([event]);
  });
});
