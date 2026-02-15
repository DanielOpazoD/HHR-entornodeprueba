import { describe, expect, it } from 'vitest';
import type { CensusAccessUser } from '@/types/censusAccess';
import {
    buildSharedCensusFileCardModel,
    resolveSharedCensusAccessDisplayName,
    resolveSharedCensusViewState
} from '@/features/census/controllers/sharedCensusViewController';

describe('sharedCensusViewController', () => {
    const accessUser = {
        id: 'user-1',
        email: 'guest@example.com',
        displayName: 'Guest User',
        role: 'viewer',
        createdAt: new Date(),
        createdBy: 'admin',
        expiresAt: new Date(),
        isActive: true
    } as CensusAccessUser;

    it('resolves denied view state for explicit errors or missing access', () => {
        expect(resolveSharedCensusViewState({
            error: 'token invalid',
            accessUser,
            isLoading: false
        })).toBe('denied');

        expect(resolveSharedCensusViewState({
            error: null,
            accessUser: null,
            isLoading: false
        })).toBe('denied');
    });

    it('resolves loading and ready states deterministically', () => {
        expect(resolveSharedCensusViewState({
            error: null,
            accessUser: null,
            isLoading: true
        })).toBe('loading');

        expect(resolveSharedCensusViewState({
            error: null,
            accessUser,
            isLoading: false
        })).toBe('ready');
    });

    it('builds current-month file card model with localized month name', () => {
        const model = buildSharedCensusFileCardModel(
            { date: '2026-02-10' } as { date: string },
            new Date('2026-02-13T10:00:00.000Z')
        );

        expect(model).toEqual({
            year: '2026',
            day: '10',
            monthName: 'Febrero',
            isCurrentMonth: true
        });
    });

    it('falls back safely for invalid month segments', () => {
        const model = buildSharedCensusFileCardModel(
            { date: '2026-13-05' } as { date: string },
            new Date('2026-02-13T10:00:00.000Z')
        );

        expect(model.monthName).toBe('13');
        expect(model.isCurrentMonth).toBe(false);
    });

    it('uses displayName first and falls back to email', () => {
        expect(resolveSharedCensusAccessDisplayName(accessUser)).toBe('Guest User');
        expect(resolveSharedCensusAccessDisplayName({
            ...accessUser,
            displayName: ''
        })).toBe('guest@example.com');
    });
});
