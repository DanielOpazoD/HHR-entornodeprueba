import { describe, expect, it, vi } from 'vitest';
import {
    CENSUS_MIGRATION_STORAGE_KEY,
    executeCensusMigrationBootstrapController
} from '@/features/census/controllers/censusMigrationBootstrapController';

describe('censusMigrationBootstrapController', () => {
    it('returns already_done when migration flag is DONE', () => {
        const storage = {
            getItem: vi.fn().mockReturnValue('DONE'),
            setItem: vi.fn()
        };

        const result = executeCensusMigrationBootstrapController(storage);

        expect(result).toEqual({
            ok: true,
            value: { outcome: 'already_done' }
        });
        expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('marks migration as SKIPPED when no DONE flag exists', () => {
        const storage = {
            getItem: vi.fn().mockReturnValue(null),
            setItem: vi.fn()
        };

        const result = executeCensusMigrationBootstrapController(storage);

        expect(result).toEqual({
            ok: true,
            value: { outcome: 'marked_skipped' }
        });
        expect(storage.setItem).toHaveBeenCalledWith(CENSUS_MIGRATION_STORAGE_KEY, 'SKIPPED');
    });

    it('returns explicit read error when storage getItem fails', () => {
        const storage = {
            getItem: vi.fn(() => {
                throw new Error('read failed');
            }),
            setItem: vi.fn()
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
            })
        };

        const result = executeCensusMigrationBootstrapController(storage);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('STORAGE_WRITE_FAILED');
        }
    });
});
