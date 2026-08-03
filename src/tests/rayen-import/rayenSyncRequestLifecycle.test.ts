import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRayenSyncRequestController } from '@/features/rayen-import/hooks/rayenSyncRequestLifecycle';

const bridge = vi.hoisted(() => ({
  request: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('@/features/rayen-import/bridge/rayenImportBridge', () => ({
  requestRayenSyncBundle: bridge.request,
  cancelRayenSyncBundleRequest: bridge.cancel,
}));

describe('rayenSyncRequestLifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => vi.useRealTimers());

  it('keeps only the current request-to-run correlation', () => {
    bridge.request.mockReturnValueOnce('request-a').mockReturnValueOnce('request-b');
    const controller = createRayenSyncRequestController();

    controller.start('2026-08-01', '2026-08-01', 'run-a', vi.fn());
    controller.start('2026-08-02', '2026-08-02', 'run-b', vi.fn());

    expect(bridge.cancel).toHaveBeenCalledWith('request-a');
    expect(controller.getRunId('request-a')).toBeNull();
    expect(controller.getRunId('request-b')).toBe('run-b');
  });

  it('invalidates the correlation before publishing a timeout', () => {
    bridge.request.mockReturnValue('request-a');
    const onTimeout = vi.fn();
    const controller = createRayenSyncRequestController();

    controller.start('2026-08-02', '2026-08-02', 'run-a', onTimeout);
    vi.advanceTimersByTime(75_000);

    expect(bridge.cancel).toHaveBeenCalledWith('request-a');
    expect(controller.getRunId('request-a')).toBeNull();
    expect(onTimeout).toHaveBeenCalledOnce();
  });
});
