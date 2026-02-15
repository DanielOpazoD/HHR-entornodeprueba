import { describe, expect, it } from 'vitest';
import {
    resolveToggleBedModeCommand,
    resolveToggleClinicalCribCommand,
    resolveToggleCompanionCribCommand
} from '@/features/census/controllers/patientRowBedConfigController';

describe('patientRowBedConfigController', () => {
    it('requires confirmation when switching to Cuna with companion crib enabled', () => {
        const result = resolveToggleBedModeCommand({
            isCunaMode: false,
            hasCompanion: true
        });

        expect(result.kind).toBe('confirmAndSetBedMode');
        if (result.kind === 'confirmAndSetBedMode') {
            expect(result.nextMode).toBe('Cuna');
            expect(result.companionPatch).toBe(false);
        }
    });

    it('switches bed mode directly when no companion crib conflict exists', () => {
        const result = resolveToggleBedModeCommand({
            isCunaMode: true,
            hasCompanion: false
        });

        expect(result).toEqual({
            kind: 'setBedMode',
            nextMode: 'Cama'
        });
    });

    it('returns explicit error when toggling companion crib in Cuna mode', () => {
        const result = resolveToggleCompanionCribCommand({
            isCunaMode: true,
            hasCompanion: false
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('COMPANION_NOT_ALLOWED_IN_CUNA');
        }
    });

    it('toggles companion crib state in Cama mode', () => {
        const result = resolveToggleCompanionCribCommand({
            isCunaMode: false,
            hasCompanion: true
        });

        expect(result).toEqual({
            ok: true,
            value: {
                kind: 'toggleCompanion',
                nextValue: false
            }
        });
    });

    it('resolves clinical crib action based on current state', () => {
        expect(resolveToggleClinicalCribCommand({ hasClinicalCrib: false })).toEqual({
            kind: 'toggleClinicalCrib',
            action: 'create'
        });
        expect(resolveToggleClinicalCribCommand({ hasClinicalCrib: true })).toEqual({
            kind: 'toggleClinicalCrib',
            action: 'remove'
        });
    });
});
