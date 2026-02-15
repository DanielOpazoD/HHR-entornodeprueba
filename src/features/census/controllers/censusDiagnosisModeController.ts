import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';

export interface DiagnosisModeStorage {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
}

export interface ToggleDiagnosisModeExecutionResult {
    nextMode: DiagnosisMode;
    persisted: boolean;
}

export const DIAGNOSIS_MODE_STORAGE_KEY = 'hhr_diagnosis_mode';

export const parseDiagnosisMode = (value: string | null): DiagnosisMode =>
    value === 'cie10' ? 'cie10' : 'free';

export const getNextDiagnosisMode = (currentMode: DiagnosisMode): DiagnosisMode =>
    currentMode === 'free' ? 'cie10' : 'free';

export const resolveDiagnosisModeStorage = (): DiagnosisModeStorage | null => {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
        return null;
    }

    const storage = (globalThis as { localStorage?: DiagnosisModeStorage }).localStorage;
    return storage || null;
};

export const resolveInitialDiagnosisMode = (storage: DiagnosisModeStorage | null): DiagnosisMode => {
    if (!storage) {
        return 'free';
    }

    try {
        return parseDiagnosisMode(storage.getItem(DIAGNOSIS_MODE_STORAGE_KEY));
    } catch {
        return 'free';
    }
};

export const executeToggleDiagnosisMode = (
    currentMode: DiagnosisMode,
    storage: DiagnosisModeStorage | null
): ToggleDiagnosisModeExecutionResult => {
    const nextMode = getNextDiagnosisMode(currentMode);

    if (!storage) {
        return {
            nextMode,
            persisted: false
        };
    }

    try {
        storage.setItem(DIAGNOSIS_MODE_STORAGE_KEY, nextMode);
        return {
            nextMode,
            persisted: true
        };
    } catch {
        return {
            nextMode,
            persisted: false
        };
    }
};
