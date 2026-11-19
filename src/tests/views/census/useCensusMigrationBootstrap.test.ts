import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCensusMigrationBootstrap } from '@/features/census/hooks/useCensusMigrationBootstrap';

const {
  mockedCreateCensusStorageRuntime,
  mockedExecuteCensusMigrationBootstrapController,
  warnMock,
} = vi.hoisted(() => ({
  mockedCreateCensusStorageRuntime: vi.fn(),
  mockedExecuteCensusMigrationBootstrapController: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock('@/features/census/controllers/censusBrowserRuntimeAdapter', () => ({
  createCensusStorageRuntime: () => mockedCreateCensusStorageRuntime(),
}));

vi.mock('@/features/census/controllers/censusMigrationBootstrapController', () => ({
  executeCensusMigrationBootstrapController: (...args: unknown[]) =>
    mockedExecuteCensusMigrationBootstrapController(...args),
}));

vi.mock('@/services/utils/loggerService', () => ({
  logger: {
    child: () => ({
      warn: warnMock,
    }),
  },
}));

describe('useCensusMigrationBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback: IdleRequestCallback) => {
        callback({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline);
        return 1;
      })
    );
    vi.stubGlobal('cancelIdleCallback', vi.fn());
  });

  it('runs migration bootstrap on mount', () => {
    const runtime = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    mockedCreateCensusStorageRuntime.mockReturnValue(runtime);
    mockedExecuteCensusMigrationBootstrapController.mockReturnValue({ ok: true });

    renderHook(() => useCensusMigrationBootstrap());

    expect(mockedExecuteCensusMigrationBootstrapController).toHaveBeenCalledWith(runtime);
  });

  it('logs warning when bootstrap fails', () => {
    const runtime = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    mockedCreateCensusStorageRuntime.mockReturnValue(runtime);
    mockedExecuteCensusMigrationBootstrapController.mockReturnValue({
      ok: false,
      error: { message: 'migration failed' },
    });

    renderHook(() => useCensusMigrationBootstrap());

    expect(warnMock).toHaveBeenCalledWith('Migration bootstrap failed', 'migration failed');
  });

  it('defers the bootstrap to idle time and cancels it on unmount', () => {
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn(() => 7)
    );

    const { unmount } = renderHook(() => useCensusMigrationBootstrap());
    unmount();

    expect(window.cancelIdleCallback).toHaveBeenCalledWith(7);
    expect(mockedExecuteCensusMigrationBootstrapController).not.toHaveBeenCalled();
  });
});
