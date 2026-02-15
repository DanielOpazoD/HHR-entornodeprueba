import { useCallback, useState } from 'react';
import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';
import {
    executeToggleDiagnosisMode,
    resolveDiagnosisModeStorage,
    resolveInitialDiagnosisMode
} from '@/features/census/controllers/censusDiagnosisModeController';

export interface UseDiagnosisModeResult {
    diagnosisMode: DiagnosisMode;
    toggleDiagnosisMode: () => void;
}

export const useDiagnosisMode = (): UseDiagnosisModeResult => {
    const [diagnosisMode, setDiagnosisMode] = useState<DiagnosisMode>(() =>
        resolveInitialDiagnosisMode(resolveDiagnosisModeStorage())
    );

    const toggleDiagnosisMode = useCallback(() => {
        setDiagnosisMode((previousMode) => {
            const execution = executeToggleDiagnosisMode(
                previousMode,
                resolveDiagnosisModeStorage()
            );

            return execution.nextMode;
        });
    }, []);

    return {
        diagnosisMode,
        toggleDiagnosisMode
    };
};
