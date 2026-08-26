import { describe, expect, it, vi } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import { RayenHistoricalCorrectionAfterCommitError } from '@/features/rayen-import/hooks/confirmRayenImport';
import { runRayenSnapshotPersistence } from '@/features/rayen-import/hooks/rayenSnapshotPersistenceExecution';

const diff = {
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 1,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 1,
  },
} as CensusImportDiff;

const committedResult = {
  appliedDiff: diff,
  skipped: [],
  historicalCorrectionsPending: false,
  confirmedHandoff: { source: 'snapshot' },
};

const createInput = ({
  activeExecutionKeys = new Set<string>(),
  isCurrent = vi.fn().mockReturnValue(true),
  persist = vi.fn().mockResolvedValue(committedResult),
  continueAfterCommit = vi.fn().mockResolvedValue(undefined),
} = {}) => ({
  executionKey: 'run-1:request-1:2026-08-25',
  activeExecutionKeys,
  isCurrent,
  startPersistence: vi.fn(),
  persist: persist as never,
  continueAfterCommit,
  finishFailedPersistence: vi.fn(),
});

describe('runRayenSnapshotPersistence', () => {
  it('owns one applied persistence lifecycle and releases its execution key', async () => {
    const input = createInput();

    const result = await runRayenSnapshotPersistence(input);

    expect(result).toMatchObject({ kind: 'committed', outcome: { kind: 'applied' } });
    expect(input.startPersistence).toHaveBeenCalledOnce();
    expect(input.persist).toHaveBeenCalledOnce();
    expect(input.continueAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'applied' })
    );
    expect(input.finishFailedPersistence).not.toHaveBeenCalled();
    expect(input.activeExecutionKeys).toEqual(new Set());
  });

  it('does not start a stale or duplicate execution', async () => {
    const stale = createInput({ isCurrent: vi.fn().mockReturnValue(false) });
    const activeExecutionKeys = new Set(['run-1:request-1:2026-08-25']);
    const duplicate = createInput({ activeExecutionKeys });

    await expect(runRayenSnapshotPersistence(stale)).resolves.toEqual({ kind: 'not_started' });
    await expect(runRayenSnapshotPersistence(duplicate)).resolves.toEqual({
      kind: 'not_started',
    });

    expect(stale.startPersistence).not.toHaveBeenCalled();
    expect(stale.persist).not.toHaveBeenCalled();
    expect(duplicate.startPersistence).not.toHaveBeenCalled();
    expect(duplicate.persist).not.toHaveBeenCalled();
    expect(activeExecutionKeys).toEqual(new Set(['run-1:request-1:2026-08-25']));
  });

  it('reports an uncommitted persistence failure without clinical continuation', async () => {
    const error = new Error('write failed');
    const input = createInput({ persist: vi.fn().mockRejectedValue(error) });

    await expect(runRayenSnapshotPersistence(input)).resolves.toEqual({ kind: 'failed' });

    expect(input.finishFailedPersistence).toHaveBeenCalledWith(error);
    expect(input.continueAfterCommit).not.toHaveBeenCalled();
    expect(input.activeExecutionKeys).toEqual(new Set());
  });

  it('routes a normal post-commit clinical failure through the failure handler', async () => {
    const error = new Error('clinical failed');
    const input = createInput({
      continueAfterCommit: vi.fn().mockRejectedValue(error),
    });

    await expect(runRayenSnapshotPersistence(input)).resolves.toEqual({ kind: 'failed' });

    expect(input.finishFailedPersistence).toHaveBeenCalledWith(error);
    expect(input.activeExecutionKeys).toEqual(new Set());
  });

  it('preserves fresh-capture propagation after an already committed correction', async () => {
    const correctionError = new RayenHistoricalCorrectionAfterCommitError(
      committedResult as never,
      new Error('historical conflict')
    );
    const clinicalError = new Error('clinical failed after correction');
    const input = createInput({
      persist: vi.fn().mockRejectedValue(correctionError),
      continueAfterCommit: vi.fn().mockRejectedValue(clinicalError),
    });

    await expect(runRayenSnapshotPersistence(input)).rejects.toBe(clinicalError);

    expect(input.continueAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'requires_fresh_capture' })
    );
    expect(input.finishFailedPersistence).not.toHaveBeenCalled();
    expect(input.activeExecutionKeys).toEqual(new Set());
  });

  it('silently releases ownership when persistence belongs to a superseded execution', async () => {
    const input = createInput({ persist: vi.fn().mockResolvedValue(null) });

    await expect(runRayenSnapshotPersistence(input)).resolves.toEqual({ kind: 'not_started' });

    expect(input.continueAfterCommit).not.toHaveBeenCalled();
    expect(input.finishFailedPersistence).not.toHaveBeenCalled();
    expect(input.activeExecutionKeys).toEqual(new Set());
  });
});
