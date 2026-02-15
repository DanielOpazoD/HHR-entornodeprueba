import { useCallback } from 'react';
import {
    executeToggleBedModeController,
    executeToggleClinicalCribController,
    executeToggleCompanionCribController
} from '@/features/census/controllers/patientRowBedConfigRuntimeController';
import type { ControllerConfirmDescriptor } from '@/features/census/controllers/controllerConfirmDescriptor';

interface UsePatientRowBedConfigActionsParams {
    bedId: string;
    isCunaMode: boolean;
    hasCompanion: boolean;
    hasClinicalCrib: boolean;
    updatePatient: (bedId: string, field: 'bedMode' | 'hasCompanionCrib', value: 'Cama' | 'Cuna' | boolean) => void;
    updateClinicalCrib: (bedId: string, field: 'create' | 'remove') => void;
    confirm: (options: ControllerConfirmDescriptor) => Promise<boolean>;
    alert: (message: string, title?: string) => Promise<void>;
}

interface UsePatientRowBedConfigActionsResult {
    toggleBedMode: () => Promise<void>;
    toggleCompanionCrib: () => Promise<void>;
    toggleClinicalCrib: () => void;
}

export const usePatientRowBedConfigActions = ({
    bedId,
    isCunaMode,
    hasCompanion,
    hasClinicalCrib,
    updatePatient,
    updateClinicalCrib,
    confirm,
    alert
}: UsePatientRowBedConfigActionsParams): UsePatientRowBedConfigActionsResult => {
    const toggleBedMode = useCallback(async () => {
        await executeToggleBedModeController({
            bedId,
            isCunaMode,
            hasCompanion,
            actions: { updatePatient },
            dialogs: { confirm }
        });
    }, [bedId, confirm, hasCompanion, isCunaMode, updatePatient]);

    const toggleCompanionCrib = useCallback(async () => {
        await executeToggleCompanionCribController({
            bedId,
            isCunaMode,
            hasCompanion,
            actions: { updatePatient },
            dialogs: { alert }
        });
    }, [alert, bedId, hasCompanion, isCunaMode, updatePatient]);

    const toggleClinicalCrib = useCallback(() => {
        executeToggleClinicalCribController({
            bedId,
            hasClinicalCrib,
            actions: { updateClinicalCrib }
        });
    }, [bedId, hasClinicalCrib, updateClinicalCrib]);

    return {
        toggleBedMode,
        toggleCompanionCrib,
        toggleClinicalCrib
    };
};
