import { afterEach, describe, expect, it, vi } from 'vitest';
import { beginPendingLogout, waitForPendingLogout } from '@/services/auth/authLogoutState';

describe('pending logout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lets a sign-in through at once when no logout is under way', async () => {
    await expect(waitForPendingLogout()).resolves.toBeUndefined();
  });

  it('holds a sign-in until the logout finished, and is done once marked', async () => {
    const finish = beginPendingLogout();
    let released = false;
    const waiting = waitForPendingLogout().then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);

    finish();
    finish();
    await waiting;
    expect(released).toBe(true);
    await expect(waitForPendingLogout()).resolves.toBeUndefined();
  });

  it('never holds a sign-in longer than five seconds', async () => {
    vi.useFakeTimers();
    const finish = beginPendingLogout();
    let released = false;
    const waiting = waitForPendingLogout().then(() => {
      released = true;
    });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(released).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(released).toBe(true);
    finish();
  });
});
