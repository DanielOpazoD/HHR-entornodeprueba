// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authoringSessionScope, guardAuthoringSession } from '@/services/session/authoringSession';
import {
  getStoredSessionOwnerKey,
  SESSION_CLEANUP_PENDING_KEY,
} from '@/services/session/sessionOwnerKey';
import {
  getSessionEpoch,
  getSessionGeneration,
  sessionEpochGuard,
} from '@/services/session/sessionStorageTransition';
import {
  admitSyntheticSession,
  clearSyntheticSession,
  replaceStoredSessionOwner,
} from '@/tests/utils/syntheticSession';

/** The block each CUDYR, Rayen and staff operation copied before the guard (reference only). */
const copiedBlock = () => {
  const owner = getStoredSessionOwnerKey(),
    generation = getSessionGeneration();
  return () => owner === getStoredSessionOwnerKey() && generation === getSessionGeneration();
};

const transitions = {
  unchanged: () => undefined,
  'a new sign-in (new generation)': () => admitSyntheticSession('user:synthetic-b', 'generation-b'),
  'the same person signs in again': () =>
    admitSyntheticSession('user:synthetic-a', 'generation-a-returned'),
  'logged out and back in under the same generation': () => {
    clearSyntheticSession();
    admitSyntheticSession('user:synthetic-a', 'generation-a');
  },
  'another tab replaced the stored owner': () => replaceStoredSessionOwner('user:synthetic-b'),
  'a logout cleanup is pending': () => localStorage.setItem(SESSION_CLEANUP_PENDING_KEY, 'cleanup'),
  'logged out': () => clearSyntheticSession(),
} as const;

// Columns: copied block, guardAuthoringSession().isCurrent(), sessionEpochGuard()().
// The guard differs from the block only where written, on purpose: a pending logout cleanup may
// already have cleared what the operation would write, and a logout followed by the same person and
// generation is still a change (the guard keeps the epoch). The epoch belongs to this tab, so a
// replacement in another tab does not move it until this tab admits it.
const expected: Record<keyof typeof transitions, [boolean, boolean, boolean]> = {
  unchanged: [true, true, true],
  'a new sign-in (new generation)': [false, false, false],
  'the same person signs in again': [false, false, false],
  'logged out and back in under the same generation': [true, false, false],
  'another tab replaced the stored owner': [false, false, true],
  'a logout cleanup is pending': [true, false, true],
  'logged out': [false, false, false],
};

beforeEach(() => admitSyntheticSession('user:synthetic-a', 'generation-a'));
afterEach(() => {
  localStorage.removeItem(SESSION_CLEANUP_PENDING_KEY);
  clearSyntheticSession();
});

describe('one session guard for asynchronous operations', () => {
  it.each(Object.keys(transitions) as Array<keyof typeof transitions>)(
    'answers like the copied block, except where written: %s',
    transition => {
      const block = copiedBlock();
      const guard = guardAuthoringSession();
      const epoch = sessionEpochGuard();
      transitions[transition]();
      expect([block(), guard.isCurrent(), epoch()]).toEqual(expected[transition]);
      if (expected[transition][1]) expect(() => guard.check()).not.toThrow();
      else expect(() => guard.check()).toThrow('La sesión cambió.');
    }
  );

  it('stops on abort before asking about the session, with the signal’s own reason', () => {
    const controller = new AbortController();
    const guard = guardAuthoringSession({ signal: controller.signal, message: 'Vuelva a abrir.' });
    expect(guard.isCurrent()).toBe(true);
    controller.abort(new DOMException('superseded', 'AbortError'));
    expect(guard.isCurrent()).toBe(false);
    expect(() => guard.check()).toThrow('superseded');
  });

  it('shows the caller’s message when the session changed', () => {
    const guard = guardAuthoringSession({ message: 'La sesión cambió. Vuelva a abrir el mes.' });
    admitSyntheticSession('user:synthetic-b', 'generation-b');
    expect(() => guard.check()).toThrow('La sesión cambió. Vuelva a abrir el mes.');
  });

  it('guards the epoch a component rendered with: a change before its re-render already counts', () => {
    const rendered = getSessionEpoch();
    admitSyntheticSession('user:synthetic-b', 'generation-b');
    expect(sessionEpochGuard(rendered)()).toBe(false);
    expect(sessionEpochGuard()()).toBe(true);
  });

  it('keys remembered data by person and session, and by nobody when no one is admitted', () => {
    const guard = guardAuthoringSession();
    expect(authoringSessionScope(guard.session)).toBe('user:synthetic-a:generation-a');
    admitSyntheticSession('user:synthetic-b', 'generation-b');
    expect(authoringSessionScope()).toBe('user:synthetic-b:generation-b');
    expect(authoringSessionScope(guard.session)).toBe('user:synthetic-a:generation-a');
    clearSyntheticSession();
    expect(authoringSessionScope()).toBe('');
  });
});
