import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyClinicalEnrichmentBatch } from '@/features/rayen-import/hooks/applyClinicalEnrichmentBatch';
import { createClinicalEnrichmentPersistenceStrategy } from '@/features/rayen-import/hooks/clinicalEnrichmentPersistenceStrategy';
import { runExclusiveDailyRecordWrite } from '@/services/repositories/dailyRecordWriteCoordinator';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { createDependencies, operations, record } from './applyClinicalEnrichmentBatch.fixtures';

beforeEach(() => {
  localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-a');
  setSessionGeneration('synthetic-generation-a');
});
afterEach(() => {
  localStorage.removeItem(SESSION_OWNER_KEY);
  setSessionGeneration(null);
});
const replaceSession = () => {
  localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-b');
  setSessionGeneration('synthetic-generation-b');
};
const input = () => ({ mode: 'enforced' as const, record, runId: 'synthetic-run-a', operations });

describe('clinical session ownership across waits', () => {
  it('checks the original session after waiting for another writer', async () => {
    let release!: () => void;
    const blocker = runExclusiveDailyRecordWrite(
      record.date,
      () =>
        new Promise<void>(resolve => {
          release = resolve;
        })
    );
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const deps = createDependencies();
    const batch = applyClinicalEnrichmentBatch({ ...input(), ...deps });
    replaceSession();
    release();
    await blocker;
    await expect(batch).rejects.toThrow('La sesión cambió.');
    expect(deps.refreshRecord).not.toHaveBeenCalled();
    expect(deps.invoke).not.toHaveBeenCalled();
  });

  it('detects a new generation even when A returns with the same owner key', async () => {
    const deps = createDependencies();
    deps.refreshRecord.mockImplementation(async () => {
      setSessionGeneration('synthetic-generation-a-returned');
      return record;
    });
    await expect(applyClinicalEnrichmentBatch({ ...input(), ...deps })).rejects.toThrow(
      'La sesión cambió.'
    );
    expect(deps.invoke).not.toHaveBeenCalled();
  });

  it.each(['functions/unavailable', 'functions/aborted'])(
    'does not retry %s after a session replacement',
    async code => {
      const deps = createDependencies();
      deps.invoke.mockImplementation(async () => {
        replaceSession();
        throw { code, message: 'revision_mismatch' };
      });
      await expect(applyClinicalEnrichmentBatch({ ...input(), ...deps })).rejects.toThrow(
        'La sesión cambió.'
      );
      expect(deps.invoke).toHaveBeenCalledOnce();
      expect(deps.refreshRecord).toHaveBeenCalledOnce();
    }
  );

  it('keeps an already committed remote result without adopting it into B', async () => {
    const deps = createDependencies();
    const refreshCommittedRecord = vi.fn();
    const invoke = vi.fn(async (...args: Parameters<typeof deps.invoke>) => {
      const committed = await deps.invoke(...args);
      replaceSession();
      return committed;
    });
    await expect(
      applyClinicalEnrichmentBatch({ ...input(), ...deps, invoke, refreshCommittedRecord })
    ).rejects.toThrow('La sesión cambió.');
    expect(invoke).toHaveBeenCalledOnce();
    expect(refreshCommittedRecord).not.toHaveBeenCalled();
  });

  it('honors the phase session captured before persistence is requested', async () => {
    const deps = createDependencies();
    const strategy = createClinicalEnrichmentPersistenceStrategy({
      ...input(),
      ...deps,
      checkSession: () => {
        if (localStorage.getItem(SESSION_OWNER_KEY) !== 'user:synthetic-a')
          throw new Error('La sesión cambió.');
      },
    });
    replaceSession();
    await expect(strategy.persist(operations)).rejects.toThrow('La sesión cambió.');
    expect(deps.invoke).not.toHaveBeenCalled();
  });
});
