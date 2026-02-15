import { describe, expect, it } from 'vitest';
import {
    CLINICAL_ACTIONS,
    getVisibleUtilityActions
} from '@/features/census/components/patient-row/patientActionMenuConfig';

describe('patientActionMenuConfig', () => {
    it('shows only safe utility actions when bed is blocked', () => {
        const actions = getVisibleUtilityActions(true).map(action => action.action);
        expect(actions).toEqual(['clear']);
    });

    it('shows full utility actions when bed is editable', () => {
        const actions = getVisibleUtilityActions(false).map(action => action.action);
        expect(actions).toEqual(['clear', 'copy', 'move']);
    });

    it('keeps clinical actions stable and ordered', () => {
        const actions = CLINICAL_ACTIONS.map(action => action.action);
        expect(actions).toEqual(['discharge', 'transfer', 'cma']);
    });
});

