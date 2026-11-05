import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import {
  getSessionEpoch,
  onSessionChange,
  setSessionGeneration,
} from '@/services/storage/sessionStorageTransition';

const Probe = () => <output>{useSessionEpoch()}</output>;

describe('session change scope', () => {
  afterEach(() => {
    setSessionGeneration(null);
    vi.restoreAllMocks();
  });

  it('tells every listener synchronously, before the page bridge message, and only on real changes', () => {
    const seen: Array<string | null> = [];
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {
      seen.push('message');
    });
    const stop = onSessionChange(generation => {
      seen.push(generation);
    });
    const before = getSessionEpoch();
    setSessionGeneration('synthetic-a');
    setSessionGeneration('synthetic-a');
    setSessionGeneration(null);
    expect(seen).toEqual(['synthetic-a', 'message', null, 'message']);
    expect(getSessionEpoch()).toBe(before + 2);
    stop();
    setSessionGeneration('synthetic-b');
    expect(seen.filter(entry => entry !== 'message')).toEqual(['synthetic-a', null]);
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('keeps notifying the others when one listener fails', () => {
    const calls: string[] = [];
    const stopFailing = onSessionChange(() => {
      throw new Error('synthetic listener failure');
    });
    const stopHealthy = onSessionChange(() => {
      calls.push('healthy');
    });
    expect(() => setSessionGeneration('synthetic-c')).not.toThrow();
    expect(calls).toEqual(['healthy']);
    stopFailing();
    stopHealthy();
  });

  it('never delivers an older generation after a listener moved the session on', () => {
    const seen: Array<string | null> = [];
    const stopFirst = onSessionChange(generation => {
      if (generation === 'synthetic-a') setSessionGeneration('synthetic-b');
    });
    const stopSecond = onSessionChange(generation => {
      seen.push(generation);
    });
    setSessionGeneration('synthetic-a');
    expect(seen).toEqual(['synthetic-b']);
    stopFirst();
    stopSecond();
  });

  it('re-renders a component on each admission and logout', () => {
    render(<Probe />);
    const start = Number(screen.getByRole('status').textContent);
    act(() => setSessionGeneration('synthetic-d'));
    expect(Number(screen.getByRole('status').textContent)).toBe(start + 1);
    act(() => setSessionGeneration(null));
    expect(Number(screen.getByRole('status').textContent)).toBe(start + 2);
  });
});
