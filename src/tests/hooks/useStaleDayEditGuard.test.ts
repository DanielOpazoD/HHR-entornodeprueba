import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const confirm = vi.fn();
const logEvent = vi.fn();

vi.mock('@/context/UIContext', () => ({ useUI: () => ({ confirm }) }));
vi.mock('@/context/AuditContext', () => ({ useAuditContext: () => ({ logEvent }) }));

import { useStaleDayEditGuard } from '@/hooks/useStaleDayEditGuard';

const CLINICAL_TODAY = '2026-06-29';

describe('useStaleDayEditGuard', () => {
  beforeEach(() => {
    confirm.mockReset();
    logEvent.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows editing the clinical today without prompting or logging', async () => {
    const { result } = renderHook(() => useStaleDayEditGuard(CLINICAL_TODAY));

    await expect(result.current(CLINICAL_TODAY)).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('confirms a previous-day edit, records the audit, and proceeds', async () => {
    confirm.mockResolvedValue(true);
    const { result } = renderHook(() => useStaleDayEditGuard(CLINICAL_TODAY));

    await expect(result.current('2026-06-28')).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({ variant: 'warning' });
    expect(logEvent).toHaveBeenCalledWith(
      'PREVIOUS_DAY_EDIT_CONFIRMED',
      'dailyRecord',
      '2026-06-28',
      expect.objectContaining({ viewedDate: '2026-06-28', clinicalToday: CLINICAL_TODAY }),
      undefined,
      '2026-06-28'
    );
  });

  it('aborts and does not log when the user cancels', async () => {
    confirm.mockResolvedValue(false);
    const { result } = renderHook(() => useStaleDayEditGuard(CLINICAL_TODAY));

    await expect(result.current('2026-06-28')).resolves.toBe(false);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('only prompts once per stale day (no fatigue on repeated edits)', async () => {
    confirm.mockResolvedValue(true);
    const { result } = renderHook(() => useStaleDayEditGuard(CLINICAL_TODAY));

    await result.current('2026-06-28');
    await result.current('2026-06-28');

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent edits to the same day onto one confirmation', async () => {
    let resolveConfirm: (value: boolean) => void = () => {};
    confirm.mockReturnValue(
      new Promise<boolean>(resolve => {
        resolveConfirm = resolve;
      })
    );
    const { result } = renderHook(() => useStaleDayEditGuard(CLINICAL_TODAY));

    const first = result.current('2026-06-28');
    const second = result.current('2026-06-28');
    resolveConfirm(true);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it('does not block a confirmed edit when audit logging throws', async () => {
    confirm.mockResolvedValue(true);
    logEvent.mockImplementation(() => {
      throw new Error('audit unavailable');
    });
    const { result } = renderHook(() => useStaleDayEditGuard(CLINICAL_TODAY));

    await expect(result.current('2026-06-28')).resolves.toBe(true);
  });

  it('steps aside under E2E mode without prompting (seeded fixed dates)', async () => {
    vi.stubEnv('VITE_E2E_MODE', 'true');
    const { result } = renderHook(() => useStaleDayEditGuard(CLINICAL_TODAY));

    await expect(result.current('2026-06-28')).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });
});
