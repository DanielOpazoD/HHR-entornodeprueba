import { patchDailyRecordWithClinicalAuthorityCallable } from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { archiveCudyrHistory } from '@/services/cudyr/cudyrHistoryService';
const h = vi.hoisted(() => ({ runtime: vi.fn(), invoke: vi.fn(), callable: vi.fn() }));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getRegionalFunctions: h.runtime },
}));
vi.mock('firebase/functions', () => ({ httpsCallable: h.callable }));
const request = {
  schemaVersion: 1 as const,
  authorityDate: '2026-11-01',
  runId: 'run-a',
  evaluations: [],
};
describe('CUDYR archive transport session ownership', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setSessionGeneration('session-a');
    h.runtime.mockResolvedValue({});
    h.callable.mockReturnValue(h.invoke);
  });
  afterEach(() => setSessionGeneration(null));
  it('does not send when regional runtime initialization crosses into B', async () => {
    h.runtime.mockImplementation(async () => {
      setSessionGeneration('session-b');
      return {};
    });
    await expect(archiveCudyrHistory(request)).rejects.toThrow('La sesión cambió.');
    expect(h.invoke).not.toHaveBeenCalled();
  });
  it('does not return a late archive response to B', async () => {
    h.invoke.mockImplementation(async () => {
      setSessionGeneration('session-b');
      return { data: { persisted: true } };
    });
    await expect(archiveCudyrHistory(request)).rejects.toThrow('La sesión cambió.');
    expect(h.invoke).toHaveBeenCalledOnce();
  });
  it('does not send an audit metadata patch when transport initialization crosses into B', async () => {
    h.runtime.mockImplementation(async () => {
      setSessionGeneration('session-b');
      return {};
    });
    await expect(
      patchDailyRecordWithClinicalAuthorityCallable({
        date: '2026-11-01',
        patch: { rayenSyncHistory: [] },
        mode: 'enforced',
      })
    ).rejects.toThrow('La sesión cambió.');
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
