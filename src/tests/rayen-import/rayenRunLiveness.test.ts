import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isRayenRunAlive } from '@/features/rayen-import/hooks/rayenRunLiveness';
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import {
  SESSION_GENERATION_KEY,
  getSessionGeneration,
  setSessionGeneration,
} from '@/services/storage/sessionStorageTransition';
import { SESSION_CLEANUP_PENDING_KEY, SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';

/** The one question every continuation of a Rayen run asks after a wait. */
const generationBefore = getSessionGeneration();
beforeEach(() => {
  localStorage.clear();
  setSessionGeneration('synthetic-generation-A');
  localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-A');
  localStorage.setItem(SESSION_GENERATION_KEY, 'synthetic-generation-A');
});
afterEach(() => {
  localStorage.clear();
  setSessionGeneration(generationBefore);
});

describe('isRayenRunAlive', () => {
  it('a run of the current session, mounted and on screen, is alive', () => {
    const session = captureAuthoringSession();
    expect(
      isRayenRunAlive({ session, isMounted: () => true, isExecutionCurrent: () => true })
    ).toBe(true);
  });

  it.each([
    ['another person signed in', () => localStorage.setItem(SESSION_OWNER_KEY, 'user:synthetic-B')],
    ['a new session began', () => setSessionGeneration('synthetic-generation-B')],
    // Owner and generation still match while the logout cleans up; the mark already ends it.
    ['the logout cleanup started', () => localStorage.setItem(SESSION_CLEANUP_PENDING_KEY, '1')],
  ])('ends when %s', (_label, end) => {
    const session = captureAuthoringSession();
    end();
    expect(isRayenRunAlive({ session })).toBe(false);
  });

  it('before the commit, also ends when its view unmounts or another execution replaced it', () => {
    const session = captureAuthoringSession();
    expect(isRayenRunAlive({ session, isMounted: () => false })).toBe(false);
    expect(isRayenRunAlive({ session, isExecutionCurrent: () => false })).toBe(false);
    // After the commit only the session is asked: the confirmed handoff still converges.
    expect(isRayenRunAlive({ session })).toBe(true);
  });
});
