import { describe, expect, it, vi } from 'vitest';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  applyConfirmedRayenImport,
  RayenStructuralPlanChangedError,
} from '@/features/rayen-import/hooks/confirmRayenImport';

const record = (lastUpdated: string): DailyRecord =>
  ({
    date: '2026-07-16',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated,
  }) as DailyRecord;

const diffWithCmaAdmission = (bedId: string, encounterId: string): CensusImportDiff => ({
  admissions: [
    {
      bedId,
      isCma: true,
      patient: { patientName: 'Paciente CMA', clinicalEpisodeId: encounterId } as never,
      source: { encounterId } as never,
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
});

describe('CMA admission retry review', () => {
  it('returns a new CMA admission plan to review instead of applying stale decisions', async () => {
    const conflict = new Error('Remote is newer');
    conflict.name = 'ConcurrencyError';
    const initialDiff = diffWithCmaAdmission('R1', 'CMA-1');
    const replannedDiff = diffWithCmaAdmission('R2', 'CMA-2');
    const stale = record('stale');
    const fresh = record('fresh');

    const caught = await applyConfirmedRayenImport({
      applyPreviousDays: false,
      cmaAdmissionResolutions: [
        {
          admissionKey: '["CMA-1","R1","CMA-1",null,"Paciente CMA"]',
          disposition: 'admit',
        },
      ],
      base: stale,
      diff: initialDiff,
      dailyRecord: {} as DailyRecordRepositoryPort,
      isAdmin: false,
      ensureRun: vi.fn(),
      applyDiff: vi.fn().mockRejectedValueOnce(conflict),
      getFreshRecord: vi.fn().mockResolvedValue(fresh),
      replanDiff: vi.fn().mockResolvedValue(replannedDiff),
      createId: () => 'id',
    }).catch(error => error as unknown);

    expect(caught).toBeInstanceOf(RayenStructuralPlanChangedError);
    expect(caught).toMatchObject({ freshRecord: fresh, replannedDiff });
  });
});
