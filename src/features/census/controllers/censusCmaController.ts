import type { CMAData, PatientData } from '@/types';
import type { ControllerConfirmDescriptor } from '@/features/census/controllers/controllerConfirmDescriptor';
import {
    type ControllerResult,
    failWithCode,
    ok
} from '@/features/census/controllers/controllerResult';

export const CMA_INTERVENTION_TYPES = [
    'Cirugía Mayor Ambulatoria',
    'Procedimiento Médico Ambulatorio'
] as const;

export interface CmaUndoRuntimeActions {
    confirm: (options: ControllerConfirmDescriptor) => Promise<boolean>;
    updatePatientMultiple: (bedId: string, fields: Partial<PatientData>) => void;
    deleteCMA: (id: string) => void;
}

export type CmaUndoOutcome = 'not_restorable' | 'cancelled' | 'restored';
export type CmaUndoRuntimeResult = ControllerResult<
    { outcome: CmaUndoOutcome },
    'CONFIRMATION_FAILED'
>;

export const NO_ORIGINAL_DATA_DIALOG: ControllerConfirmDescriptor = {
    title: 'No se puede deshacer',
    message: 'Este registro no tiene datos originales guardados. Fue creado antes de que se implementara esta función.',
    confirmText: 'Entendido',
    cancelText: '',
    variant: 'warning'
};

export const buildRestoreCmaDialog = (item: CMAData): ControllerConfirmDescriptor => ({
    title: 'Deshacer Egreso CMA',
    message: `¿Restaurar a ${item.patientName} a la cama ${item.originalBedId}?`,
    confirmText: 'Sí, restaurar',
    cancelText: 'Cancelar',
    variant: 'warning'
});

export const executeUndoCmaController = async (
    item: CMAData,
    actions: CmaUndoRuntimeActions
): Promise<CmaUndoRuntimeResult> => {
    if (!item.originalBedId || !item.originalData) {
        try {
            await actions.confirm(NO_ORIGINAL_DATA_DIALOG);
        } catch {
            return failWithCode('CONFIRMATION_FAILED', 'No se pudo abrir la confirmación de deshacer CMA.');
        }

        return ok({ outcome: 'not_restorable' });
    }

    let confirmed = false;
    try {
        confirmed = await actions.confirm(buildRestoreCmaDialog(item));
    } catch {
        return failWithCode('CONFIRMATION_FAILED', 'No se pudo confirmar el deshacer CMA.');
    }

    if (!confirmed) {
        return ok({ outcome: 'cancelled' });
    }

    actions.updatePatientMultiple(item.originalBedId, item.originalData);
    actions.deleteCMA(item.id);

    return ok({ outcome: 'restored' });
};
