import { describe, expect, it, vi } from 'vitest';
import {
  CENSUS_MIGRATION_STORAGE_KEY,
  createCensusMigrationStorageRuntime,
  executeCensusMigrationBootstrapController,
} from '@/features/census/controllers/censusMigrationBootstrapController';

describe('censusMigrationBootstrapController', () => {
  it('returns already_done when migration flag is DONE', () => {
    const storage = {
      getItem: vi.fn().mockReturnValue('DONE'),
      setItem: vi.fn(),
    };

    const result = executeCensusMigrationBootstrapController(storage);

    expect(result).toEqual({
      ok: true,
      value: { outcome: 'already_done' },
    });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('marks migration as SKIPPED when no DONE flag exists', () => {
    const storage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
    };

    const result = executeCensusMigrationBootstrapController(storage);

    expect(result).toEqual({
      ok: true,
      value: { outcome: 'marked_skipped' },
    });
    expect(storage.setItem).toHaveBeenCalledWith(CENSUS_MIGRATION_STORAGE_KEY, 'SKIPPED');
  });

  it('returns explicit read error when storage getItem fails', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('read failed');
      }),
      setItem: vi.fn(),
    };

    const result = executeCensusMigrationBootstrapController(storage);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_READ_FAILED');
    }
  });

  it('returns explicit write error when storage setItem fails', () => {
    const storage = {
      getItem: vi.fn().mockReturnValue('SKIPPED'),
      setItem: vi.fn(() => {
        throw new Error('write failed');
      }),
    };

    const result = executeCensusMigrationBootstrapController(storage);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_WRITE_FAILED');
    }
  });

  it('creates browser storage runtime bound to localStorage', () => {
    const getItemSpy = vi.spyOn(window.localStorage, 'getItem');
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem');
    const runtime = createCensusMigrationStorageRuntime();

    runtime.getItem('migration-key');
    runtime.setItem('migration-key', 'SKIPPED');

    expect(getItemSpy).toHaveBeenCalledWith('migration-key');
    expect(setItemSpy).toHaveBeenCalledWith('migration-key', 'SKIPPED');
  });

  it('supports injecting browser runtime adapters', () => {
    const runtime = createCensusMigrationStorageRuntime({
      getItem: vi.fn().mockReturnValue('DONE'),
      setItem: vi.fn(),
    });

    const result = executeCensusMigrationBootstrapController(runtime);

    expect(result).toEqual({
      ok: true,
      value: { outcome: 'already_done' },
    });
  });
});
