import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireGoogleLoginLock,
  getGoogleLoginLockStatus,
  refreshGoogleLoginLock,
  releaseGoogleLoginLock,
  startGoogleLoginLockHeartbeat,
} from '@/services/auth/googleLoginLock';

const GOOGLE_LOGIN_LOCK_KEY = 'hhr_google_login_lock_v1';

describe('googleLoginLock', () => {
  beforeEach(() => {
    localStorage.removeItem(GOOGLE_LOGIN_LOCK_KEY);
    vi.useRealTimers();
  });

  it('acquires lock when not present', () => {
    expect(acquireGoogleLoginLock()).toBe(true);
    expect(localStorage.getItem(GOOGLE_LOGIN_LOCK_KEY)).not.toBeNull();
  });

  it('blocks acquire when another active owner holds lock', () => {
    localStorage.setItem(
      GOOGLE_LOGIN_LOCK_KEY,
      JSON.stringify({
        owner: 'other-tab',
        timestamp: Date.now(),
      })
    );

    expect(acquireGoogleLoginLock()).toBe(false);
    const status = getGoogleLoginLockStatus();
    expect(status.active).toBe(true);
    expect(status.ownedByCurrentTab).toBe(false);
    expect(status.remainingMs).toBeGreaterThan(0);
  });

  it('acquires lock when existing lock is stale', () => {
    localStorage.setItem(
      GOOGLE_LOGIN_LOCK_KEY,
      JSON.stringify({
        owner: 'stale-tab',
        timestamp: Date.now() - 60_000,
      })
    );

    expect(acquireGoogleLoginLock()).toBe(true);
  });

  it('refreshes timestamp for current owner via heartbeat', () => {
    vi.useFakeTimers();
    expect(acquireGoogleLoginLock()).toBe(true);

    const initialRaw = localStorage.getItem(GOOGLE_LOGIN_LOCK_KEY);
    expect(initialRaw).not.toBeNull();
    const initialTs = JSON.parse(initialRaw as string).timestamp as number;

    const stop = startGoogleLoginLockHeartbeat(1000);
    vi.advanceTimersByTime(1000);
    stop();

    const nextRaw = localStorage.getItem(GOOGLE_LOGIN_LOCK_KEY);
    expect(nextRaw).not.toBeNull();
    const nextTs = JSON.parse(nextRaw as string).timestamp as number;

    expect(nextTs).toBeGreaterThanOrEqual(initialTs);
  });

  it('releases lock when owned by current tab', () => {
    expect(acquireGoogleLoginLock()).toBe(true);
    refreshGoogleLoginLock();
    releaseGoogleLoginLock();
    expect(localStorage.getItem(GOOGLE_LOGIN_LOCK_KEY)).toBeNull();
  });
});
