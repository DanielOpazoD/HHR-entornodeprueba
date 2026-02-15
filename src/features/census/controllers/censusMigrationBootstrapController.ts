import {
    failWithCode,
    ok,
    type ControllerResult
} from '@/features/census/controllers/controllerResult';

export interface CensusMigrationStorage {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
}

export const CENSUS_MIGRATION_STORAGE_KEY = 'MIGRATION_V1_PATIENT_MASTER';

export type CensusMigrationOutcome = 'already_done' | 'marked_skipped';
export type CensusMigrationErrorCode = 'STORAGE_READ_FAILED' | 'STORAGE_WRITE_FAILED';

export type CensusMigrationBootstrapResult = ControllerResult<
    { outcome: CensusMigrationOutcome },
    CensusMigrationErrorCode
>;

export const executeCensusMigrationBootstrapController = (
    storage: CensusMigrationStorage
): CensusMigrationBootstrapResult => {
    let currentFlag: string | null;

    try {
        currentFlag = storage.getItem(CENSUS_MIGRATION_STORAGE_KEY);
    } catch {
        return failWithCode('STORAGE_READ_FAILED', 'No se pudo leer el estado de migración del censo.');
    }

    if (currentFlag === 'DONE') {
        return ok({ outcome: 'already_done' });
    }

    try {
        storage.setItem(CENSUS_MIGRATION_STORAGE_KEY, 'SKIPPED');
        return ok({ outcome: 'marked_skipped' });
    } catch {
        return failWithCode('STORAGE_WRITE_FAILED', 'No se pudo guardar el estado de migración del censo.');
    }
};
