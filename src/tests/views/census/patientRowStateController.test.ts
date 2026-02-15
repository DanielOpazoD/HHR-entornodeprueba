import { describe, expect, it } from 'vitest';
import type { PatientData } from '@/types';
import { derivePatientRowState } from '@/features/census/controllers/patientRowStateController';

describe('patientRowStateController', () => {
    it('derives default-safe state when data is missing', () => {
        expect(derivePatientRowState(undefined)).toEqual({
            isCunaMode: false,
            hasCompanion: false,
            hasClinicalCrib: false,
            isBlocked: false,
            isEmpty: true
        });
    });

    it('derives row flags from patient data', () => {
        const data = {
            patientName: 'RN 1',
            bedMode: 'Cuna',
            hasCompanionCrib: true,
            clinicalCrib: { bedMode: 'Cuna' },
            isBlocked: true
        } as PatientData;

        expect(derivePatientRowState(data)).toEqual({
            isCunaMode: true,
            hasCompanion: true,
            hasClinicalCrib: true,
            isBlocked: true,
            isEmpty: false
        });
    });
});
