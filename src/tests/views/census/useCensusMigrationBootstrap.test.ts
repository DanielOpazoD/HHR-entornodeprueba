import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCensusMigrationBootstrap } from '@/features/census/hooks/useCensusMigrationBootstrap';

const mockedCreateCensusMigrationStorageRuntime = vi.fn();
const mockedExecuteCensusMigrationBootstrapController = vi.fn();

vi.mock('@/features/census/controllers/censusMigrationBootstrapController', () => ({
  createCensusMigrationStorageRuntime: () => mockedCreateCensusMigrationStorageRuntime(),
  executeCensusMigrationBootstrapController: (...args: unknown[]) =>
    mockedExecuteCensusMigrationBootstrapController(...args),
}));

describe('useCensusMigrationBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs migration bootstrap on mount', () => {
    const runtime = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    mockedCreateCensusMigrationStorageRuntime.mockReturnValue(runtime);
    mockedExecuteCensusMigrationBootstrapController.mockReturnValue({ ok: true });

    renderHook(() => useCensusMigrationBootstrap());

    expect(mockedCreateCensusMigrationStorageRuntime).toHaveBeenCalledTimes(1);
    expect(mockedExecuteCensusMigrationBootstrapController).toHaveBeenCalledWith(runtime);
  });

  it('logs error when bootstrap fails', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runtime = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    mockedCreateCensusMigrationStorageRuntime.mockReturnValue(runtime);
    mockedExecuteCensusMigrationBootstrapController.mockReturnValue({
      ok: false,
      error: { message: 'migration failed' },
    });

    renderHook(() => useCensusMigrationBootstrap());

    expect(consoleErrorSpy).toHaveBeenCalledWith('[Migration] Failed:', 'migration failed');
    consoleErrorSpy.mockRestore();
  });
});
