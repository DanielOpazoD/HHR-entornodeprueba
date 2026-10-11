import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ recover: vi.fn(), telemetry: vi.fn(), generation: 'session' }));
vi.mock('@/services/storage/sync/publicCudyrPolicyRecovery', () => ({
  recoverPolicyBlockedCudyrArchives: mocks.recover,
}));
vi.mock('@/services/storage/sessionStorageTransition', () => ({
  getSessionGeneration: () => mocks.generation,
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: mocks.telemetry,
}));
import { recoverCudyrArchivesAfterClinicalSync as recoverWithPolicy } from '@/features/rayen-import/hooks/recoverCudyrArchivesAfterClinicalSync';
import type { ClinicalStageResult } from '@/features/rayen-import/contracts/clinicalStageResult';
import type { RayenImportPolicyStatus } from '@/features/rayen-import/hooks/useRayenImportMode';
import type { ClinicalEnrichmentBatchMode } from '@/features/rayen-import/settings/rayenImportSettings';

const recoverCudyrArchivesAfterClinicalSync = (
  result: ClinicalStageResult,
  status: RayenImportPolicyStatus,
  mode: ClinicalEnrichmentBatchMode,
  generation: string | null
) =>
  recoverWithPolicy(
    result,
    () => ({
      status,
      policy: {
        mode: 'preview',
        clinicalBatchMode: mode,
        revision: 3,
      },
    }),
    3,
    generation
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.recover.mockResolvedValue(17);
  mocks.generation = 'session';
});
describe('CUDYR recovery after the normal clinical synchronization', () => {
  it('recovers after completion under confirmed enforced authority, fenced by the originating attempt', async () => {
    await recoverCudyrArchivesAfterClinicalSync(
      { status: 'complete' },
      'ready',
      'enforced',
      'session'
    );
    expect(mocks.recover).toHaveBeenCalledWith(true, 'session', expect.any(Function));
  });
  it.each([
    ['failed', 'ready', 'enforced', 'session'],
    ['partial', 'ready', 'enforced', 'session'],
    ['complete', 'fallback', 'enforced', 'session'],
    ['complete', 'ready', 'off', 'session'],
    ['complete', 'ready', 'shadow', 'session'],
    ['complete', 'ready', 'enforced', null],
    ['complete', 'ready', 'enforced', 'old-session'],
  ] as const)(
    'does not recover with %s / %s / %s / %s',
    async (status, policy, mode, generation) => {
      await recoverCudyrArchivesAfterClinicalSync(
        { status } as ClinicalStageResult,
        policy as RayenImportPolicyStatus,
        mode as ClinicalEnrichmentBatchMode,
        generation
      );
      expect(mocks.recover).not.toHaveBeenCalled();
    }
  );
  it('does not dispatch archives if another run supersedes the completed clinical request', async () => {
    let current = true;
    const pending = recoverWithPolicy(
      { status: 'complete' },
      () => ({
        status: 'ready',
        policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 3 },
      }),
      3,
      'session',
      () => current
    );
    current = false;
    await pending;
    expect(mocks.recover).not.toHaveBeenCalled();
  });
  it('keeps a confirmed clinical result intact if the optional recovery fails', async () => {
    mocks.recover.mockRejectedValue(new Error('recovery unavailable'));
    await expect(
      recoverCudyrArchivesAfterClinicalSync({ status: 'complete' }, 'ready', 'enforced', 'session')
    ).resolves.toBeUndefined();
    expect(mocks.telemetry).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', operation: 'cudyr_archive_recovery_unavailable' })
    );
  });
  it.each(['fallback', 'revision'] as const)(
    'reads the current policy after lazy recovery loading: %s',
    change => {
      const current = {
        status: 'ready' as RayenImportPolicyStatus,
        policy: { mode: 'preview' as const, clinicalBatchMode: 'enforced' as const, revision: 3 },
      };
      const pending = recoverWithPolicy({ status: 'complete' }, () => current, 3, 'session');
      if (change === 'fallback') current.status = 'fallback';
      else current.policy.revision = 4;
      return pending.then(() => expect(mocks.recover).not.toHaveBeenCalled());
    }
  );
});
