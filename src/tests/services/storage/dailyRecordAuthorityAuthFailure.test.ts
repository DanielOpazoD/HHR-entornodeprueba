import { describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: { ready: Promise.resolve(), getCurrentUser: auth.user },
}));
vi.mock('@/services/storage/firestore/firestoreRayenClinicalAuthorityMode', () => ({
  resolveEffectiveDailyRecordAuthorityMode: async () => 'enforced',
}));
import { resolveAuthenticatedDailyRecordAuthorityMode } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';

describe('advisory authority authentication', () => {
  it('distinguishes unavailable authentication from an absent session', async () => {
    const error = new Error('synthetic auth unavailable');
    auth.user.mockImplementation(() => {
      throw error;
    });
    expect(await resolveAuthenticatedDailyRecordAuthorityMode()).toEqual({
      kind: 'unavailable',
      error,
    });
  });
  it('preserves the absent-session and authenticated routing decisions', async () => {
    auth.user.mockReturnValue(null);
    expect(await resolveAuthenticatedDailyRecordAuthorityMode()).toBeNull();
    auth.user.mockReturnValue({ isAnonymous: false });
    expect(await resolveAuthenticatedDailyRecordAuthorityMode()).toBe('enforced');
  });
});
