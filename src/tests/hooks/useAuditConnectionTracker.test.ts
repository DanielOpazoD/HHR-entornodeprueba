import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAuditConnectionTracker } from '@/hooks/useAuditConnectionTracker';
import * as runtime from '@/services/admin/auditSession/auditConnectionRuntime';
import type { AuthUser } from '@/types/authRoleTypes';

const NURSE: AuthUser = {
  uid: 'uid-nurse',
  email: 'enfermera@hospital.test',
  displayName: 'Enfermera Uno',
};
const IDENTITY = { uid: NURSE.uid, email: NURSE.email, name: 'Enfermera Uno' };

describe('useAuditConnectionTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens the connection, beats every minute and records network drops', async () => {
    const { unmount } = renderHook(() => useAuditConnectionTracker(NURSE));
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.beginCurrentAuditConnection).toHaveBeenCalledWith(IDENTITY);

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.dynamicImportSettled();
    expect(runtime.touchCurrentAuditConnection).toHaveBeenCalledWith(IDENTITY);

    // One event at a time: each one loads the runtime before acting.
    const dispatch = async (type: 'offline' | 'online') => {
      window.dispatchEvent(new Event(type));
      await vi.dynamicImportSettled();
      await vi.advanceTimersByTimeAsync(0);
    };
    await dispatch('offline');
    expect(runtime.markCurrentAuditConnectionOffline).toHaveBeenCalledWith(NURSE.uid);
    await dispatch('online');
    expect(runtime.markCurrentAuditConnectionOnline).toHaveBeenCalledWith(NURSE.uid);

    unmount();
    vi.mocked(runtime.touchCurrentAuditConnection).mockClear();
    await vi.advanceTimersByTimeAsync(120_000);
    await vi.dynamicImportSettled();
    expect(runtime.touchCurrentAuditConnection).not.toHaveBeenCalled();
  });

  it('does nothing without a signed-in user', async () => {
    renderHook(() => useAuditConnectionTracker(null));
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.dynamicImportSettled();

    expect(runtime.beginCurrentAuditConnection).not.toHaveBeenCalled();
    expect(runtime.touchCurrentAuditConnection).not.toHaveBeenCalled();
  });
});
