import { act } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import type { AuthSessionState } from '@/types/authSessionTypes';
import {
  installResolvedAuthBootstrapTestLifecycle,
  renderResolvedAuthBootstrap,
  flushBootstrapSetup,
} from './useAuthStateSupport.testUtils';

describe('auth bootstrap lifecycle', () => {
  installResolvedAuthBootstrapTestLifecycle();
  it.each(['redirect', 'current'] as const)(
    'does not subscribe after unmount during %s',
    async stage => {
      type Outcome = ApplicationOutcome<AuthSessionState | null>;
      let finish!: (value: Outcome) => void;
      const pending = new Promise<Outcome>(resolve => {
        finish = resolve;
      });
      const empty = { status: 'success', data: null, issues: [] } as Outcome;
      const subscribe = vi.fn(() => vi.fn());
      const hook = renderResolvedAuthBootstrap({
        resolveRedirectAuthSessionOutcome: vi.fn(() =>
          stage === 'redirect' ? pending : Promise.resolve(empty)
        ),
        resolveCurrentAuthSessionOutcome: vi.fn(() =>
          stage === 'current' ? pending : Promise.resolve(empty)
        ),
        onAuthSessionStateChange: subscribe,
      });
      await act(flushBootstrapSetup);
      hook.unmount();
      await act(async () => {
        finish(empty);
        await flushBootstrapSetup();
      });
      expect(subscribe).not.toHaveBeenCalled();
    }
  );
  it('keeps one subscription in StrictMode across rerenders and removes it on unmount', async () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const hook = renderResolvedAuthBootstrap({
      wrapper: StrictMode,
      resolveRedirectAuthSessionOutcome: vi
        .fn()
        .mockResolvedValue({ status: 'success', data: null, issues: [] }),
      resolveCurrentAuthSessionOutcome: vi
        .fn()
        .mockResolvedValue({ status: 'success', data: null, issues: [] }),
      onAuthSessionStateChange: subscribe,
    });
    await act(flushBootstrapSetup);
    hook.rerender();
    await act(flushBootstrapSetup);
    expect(subscribe).toHaveBeenCalledTimes(1);
    hook.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
