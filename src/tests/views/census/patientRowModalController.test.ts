import { describe, expect, it, vi } from 'vitest';
import { resolvePatientRowDemographicsBinding } from '@/features/census/controllers/patientRowModalController';

describe('patientRowModalController', () => {
    it('uses main demographics target for parent rows', () => {
        const onSaveDemographics = vi.fn();
        const onSaveCribDemographics = vi.fn();

        const result = resolvePatientRowDemographicsBinding({
            bedId: 'R1',
            isSubRow: false,
            onSaveDemographics,
            onSaveCribDemographics
        });

        expect(result.targetBedId).toBe('R1');
        expect(result.onSave).toBe(onSaveDemographics);
    });

    it('uses crib demographics target for sub rows', () => {
        const onSaveDemographics = vi.fn();
        const onSaveCribDemographics = vi.fn();

        const result = resolvePatientRowDemographicsBinding({
            bedId: 'R1',
            isSubRow: true,
            onSaveDemographics,
            onSaveCribDemographics
        });

        expect(result.targetBedId).toBe('R1-cuna');
        expect(result.onSave).toBe(onSaveCribDemographics);
    });
});
