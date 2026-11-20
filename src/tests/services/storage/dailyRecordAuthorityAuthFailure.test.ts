// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ user: vi.fn(), fence: true }));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: { ready: Promise.resolve(), getCurrentUser: auth.user },
}));
vi.mock('@/services/storage/firestore/firestoreRayenClinicalAuthorityMode', () => ({
  isServerClinicalWriteFenceActive: async () => auth.fence,
}));
import { shouldRouteDailyRecordWriteViaCallable } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';

describe('advisory authority routing', () => {
  beforeEach(() => {
    auth.fence = true;
    auth.user.mockReset();
  });

  it('writes directly when the session cannot be checked, so the rules decide', async () => {
    auth.user.mockImplementation(() => {
      throw new Error('synthetic auth unavailable');
    });
    expect(await shouldRouteDailyRecordWriteViaCallable()).toBe(false);
  });

  it('routes only a signed-in, non-anonymous user behind the server fence', async () => {
    auth.user.mockReturnValue(null);
    expect(await shouldRouteDailyRecordWriteViaCallable()).toBe(false);
    auth.user.mockReturnValue({ isAnonymous: true });
    expect(await shouldRouteDailyRecordWriteViaCallable()).toBe(false);
    auth.user.mockReturnValue({ isAnonymous: false });
    expect(await shouldRouteDailyRecordWriteViaCallable()).toBe(true);
  });

  it('writes directly without the server fence, whoever is signed in', async () => {
    auth.fence = false;
    auth.user.mockReturnValue({ isAnonymous: false });
    expect(await shouldRouteDailyRecordWriteViaCallable()).toBe(false);
  });
});
