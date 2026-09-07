import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TIMEOUT_MS } from '@/constants/security';
import type { AuthChannelMessage } from '@/services/auth/authBroadcastChannel';
const { listeners, send } = vi.hoisted(() => ({
  listeners: new Set<(message: AuthChannelMessage) => void>(),
  send: vi.fn(),
}));
vi.mock('@/services/auth/authBroadcastChannel', () => ({
  onAuthChannelMessage: (listener: (message: AuthChannelMessage) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  broadcastSessionActivity: send,
}));
import { startSessionActivityMonitor } from '@/services/auth/sessionActivityMonitor';

const tab = (storage: Storage = localStorage) =>
  Object.assign(new EventTarget(), {
    localStorage: storage,
    document: Object.assign(new EventTarget(), { visibilityState: 'visible' }),
  }) as unknown as Window;
const cleanups: Array<() => void> = [];
const start = (user: string, target = tab()) => {
  const expired = vi.fn();
  cleanups.push(startSessionActivityMonitor(user, expired, target));
  return { target, expired };
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
  localStorage.clear();
  send.mockClear();
});
afterEach(() => {
  cleanups.splice(0).forEach(stop => stop());
  vi.clearAllTimers();
  vi.useRealTimers();
  localStorage.clear();
});

describe('shared inactivity', () => {
  it('keeps an idle tab alive while another same-user tab works, then expires both', () => {
    const idle = start('same');
    const active = start('same');
    vi.advanceTimersByTime(SESSION_TIMEOUT_MS - 1000);
    active.target.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(1000);
    expect(idle.expired).not.toHaveBeenCalled();
    expect(active.expired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SESSION_TIMEOUT_MS - 1000);
    vi.advanceTimersByTime(1000);
    expect(idle.expired).toHaveBeenCalledTimes(1);
    expect(active.expired).toHaveBeenCalledTimes(1);
  });
  it('does not extend a different user session', () => {
    const idle = start('one');
    const active = start('two');
    vi.advanceTimersByTime(SESSION_TIMEOUT_MS - 1000);
    active.target.dispatchEvent(new Event('keydown'));
    listeners.forEach(listener =>
      listener({ type: 'ACTIVITY', userId: 'two', at: Date.now(), tabId: 'peer' })
    );
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);
    expect(idle.expired).toHaveBeenCalledTimes(1);
    expect(active.expired).not.toHaveBeenCalled();
  });
  it('rechecks storage on visibility without treating wake-up as activity', () => {
    const idle = start('one');
    vi.setSystemTime(Date.now() + SESSION_TIMEOUT_MS + 1000);
    localStorage.setItem('hhr_auth_activity:one', String(Date.now() - 1000));
    idle.target.document.dispatchEvent(new Event('visibilitychange'));
    expect(idle.expired).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + SESSION_TIMEOUT_MS);
    idle.target.document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(1000);
    expect(idle.expired).toHaveBeenCalledTimes(1);
  });
  it('bounds publications and publishes the final activity timestamp', () => {
    const active = start('one');
    vi.advanceTimersByTime(1000);
    for (let i = 0; i < 100; i++) active.target.dispatchEvent(new Event('mousemove'));
    const lastEvent = Date.now();
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(14000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('hhr_auth_activity:one')).toBe(String(lastEvent));
  });
  it('uses the channel when storage is blocked and ignores malformed/future activity', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    const idle = start('one', tab(blocked));
    vi.advanceTimersByTime(SESSION_TIMEOUT_MS - 1000);
    listeners.forEach(listener =>
      listener({ type: 'ACTIVITY', userId: 'one', at: Date.now(), tabId: 'peer' })
    );
    vi.advanceTimersByTime(1000);
    expect(idle.expired).not.toHaveBeenCalled();
    for (const at of [NaN, Infinity, Date.now() + SESSION_TIMEOUT_MS * 2]) {
      listeners.forEach(listener =>
        listener({ type: 'ACTIVITY', userId: 'one', at, tabId: 'peer' })
      );
    }
    vi.advanceTimersByTime(SESSION_TIMEOUT_MS - 1000);
    vi.advanceTimersByTime(1000);
    expect(idle.expired).toHaveBeenCalledTimes(1);
  });
  it('flushes trailing activity before hiding and removes the trailing timer', () => {
    const active = start('one');
    vi.advanceTimersByTime(1000);
    active.target.dispatchEvent(new Event('keydown'));
    Object.assign(active.target.document, { visibilityState: 'hidden' });
    active.target.document.dispatchEvent(new Event('visibilitychange'));
    expect(localStorage.getItem('hhr_auth_activity:one')).toBe(String(Date.now()));
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(14000);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it.each(['read', 'write', 'neither'] as const)(
    'accepts queued channel activity when storage %s is blocked',
    failure => {
      const blocked = {
        getItem: () => {
          if (failure === 'read') throw new Error('blocked');
          return null;
        },
        setItem: () => {
          if (failure === 'write') throw new Error('quota');
        },
      } as unknown as Storage;
      const idle = start('one', tab(blocked));
      vi.advanceTimersByTime(SESSION_TIMEOUT_MS);
      expect(idle.expired).not.toHaveBeenCalled();
      idle.target.document.dispatchEvent(new Event('visibilitychange'));
      listeners.forEach(listener =>
        listener({ type: 'ACTIVITY', userId: 'one', at: Date.now() - 500, tabId: 'peer' })
      );
      vi.advanceTimersByTime(1000);
      expect(idle.expired).not.toHaveBeenCalled();
      vi.advanceTimersByTime(SESSION_TIMEOUT_MS);
      expect(idle.expired).toHaveBeenCalledTimes(1);
    }
  );
  it('does not throttle real activity after publishing an unchanged hidden timestamp', () => {
    const active = start('one');
    vi.advanceTimersByTime(SESSION_TIMEOUT_MS - 2000);
    Object.assign(active.target.document, { visibilityState: 'hidden' });
    active.target.document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(1000);
    active.target.dispatchEvent(new Event('keydown'));
    expect(localStorage.getItem('hhr_auth_activity:one')).toBe(String(Date.now()));
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('removes timers and listeners on teardown without publishing late activity', () => {
    const active = start('one');
    vi.advanceTimersByTime(1);
    active.target.dispatchEvent(new Event('scroll'));
    cleanups.splice(0).forEach(stop => stop());
    send.mockClear();
    active.target.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(SESSION_TIMEOUT_MS * 2);
    expect(active.expired).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
