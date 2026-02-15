import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { DailyRecord, PatientData } from '@/types';
import type { StabilityRules } from '@/hooks/useStabilityRules';
import type { PatientRowAction } from '@/features/census/components/patient-row/patientActionMenuConfig';
import {
    type DischargeRuntimeActions,
    type MoveOrCopyRuntimeActions,
    type TransferRuntimeActions,
    executeDischargeController,
    executeMoveOrCopyController,
    executeTransferController
} from '@/features/census/controllers/censusActionRuntimeController';
import {
    type RowActionRuntimeActions,
    type RowActionRuntimeConfirm,
    executeRowActionController
} from '@/features/census/controllers/censusRowActionRuntimeController';
import {
    getDischargeErrorTitle,
    getMoveOrCopyErrorTitle,
    getTransferErrorTitle
} from '@/features/census/controllers/censusActionErrorPresentation';
import type {
    DischargeExecutionInput,
    TransferExecutionInput
} from '@/features/census/controllers/censusActionExecutionController';
import type {
    ActionState,
    DischargeState,
    TransferState
} from '@/features/census/types/censusActionTypes';

interface UseCensusActionCommandsControllerParams {
    actionStateRef: MutableRefObject<ActionState>;
    dischargeStateRef: MutableRefObject<DischargeState>;
    transferStateRef: MutableRefObject<TransferState>;
    recordRef: MutableRefObject<DailyRecord | null>;
    stabilityRulesRef: MutableRefObject<StabilityRules>;
    clearPatientRef: MutableRefObject<RowActionRuntimeActions['clearPatient']>;
    moveOrCopyPatientRef: MutableRefObject<MoveOrCopyRuntimeActions['moveOrCopyPatient']>;
    addDischargeRef: MutableRefObject<DischargeRuntimeActions['addDischarge']>;
    updateDischargeRef: MutableRefObject<DischargeRuntimeActions['updateDischarge']>;
    addTransferRef: MutableRefObject<TransferRuntimeActions['addTransfer']>;
    updateTransferRef: MutableRefObject<TransferRuntimeActions['updateTransfer']>;
    addCmaRef: MutableRefObject<RowActionRuntimeActions['addCMA']>;
    copyPatientToDateRef: MutableRefObject<MoveOrCopyRuntimeActions['copyPatientToDate']>;
    confirmRef: MutableRefObject<RowActionRuntimeConfirm['confirm']>;
    notifyErrorRef: MutableRefObject<(title: string, message?: string) => void>;
    setActionState: Dispatch<SetStateAction<ActionState>>;
    setDischargeState: Dispatch<SetStateAction<DischargeState>>;
    setTransferState: Dispatch<SetStateAction<TransferState>>;
    getCurrentTime: () => string;
}

export interface CensusActionCommandsController {
    executeMoveOrCopy: (targetDate?: string) => void;
    executeDischarge: (data?: DischargeExecutionInput) => void;
    executeTransfer: (data?: TransferExecutionInput) => void;
    handleRowAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
}

export const useCensusActionCommandsController = ({
    actionStateRef,
    dischargeStateRef,
    transferStateRef,
    recordRef,
    stabilityRulesRef,
    clearPatientRef,
    moveOrCopyPatientRef,
    addDischargeRef,
    updateDischargeRef,
    addTransferRef,
    updateTransferRef,
    addCmaRef,
    copyPatientToDateRef,
    confirmRef,
    notifyErrorRef,
    setActionState,
    setDischargeState,
    setTransferState,
    getCurrentTime
}: UseCensusActionCommandsControllerParams): CensusActionCommandsController => {
    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const handleRowAction = useCallback(async (action: PatientRowAction, bedId: string, patient: PatientData) => {
        const result = await executeRowActionController({
            action,
            bedId,
            patient,
            stabilityRules: stabilityRulesRef.current,
            actions: {
                clearPatient: clearPatientRef.current,
                addCMA: addCmaRef.current,
                setMovement: setActionState,
                openDischarge: (dischargePatch) => {
                    setDischargeState(prev => ({
                        ...prev,
                        ...dischargePatch
                    }));
                },
                openTransfer: (transferPatch) => {
                    setTransferState(prev => ({
                        ...prev,
                        ...transferPatch
                    }));
                }
            },
            confirmRuntime: { confirm: confirmRef.current }
        });

        if (!result.ok) {
            notifyErrorRef.current('Acción bloqueada', result.error.message);
        }
    }, [
        addCmaRef,
        clearPatientRef,
        confirmRef,
        notifyErrorRef,
        setActionState,
        setDischargeState,
        setTransferState,
        stabilityRulesRef
    ]);

    const executeMoveOrCopy = useCallback((targetDate?: string) => {
        void (async () => {
            try {
                const result = await executeMoveOrCopyController({
                    actionState: actionStateRef.current,
                    record: recordRef.current,
                    targetDate,
                    actions: {
                        moveOrCopyPatient: moveOrCopyPatientRef.current,
                        copyPatientToDate: copyPatientToDateRef.current
                    }
                });

                if (!isMountedRef.current) {
                    return;
                }

                if (!result.ok) {
                    notifyErrorRef.current(getMoveOrCopyErrorTitle(result.error.code), result.error.message);
                    return;
                }

                setActionState(result.value.nextActionState);
            } catch {
                if (!isMountedRef.current) {
                    return;
                }

                notifyErrorRef.current('No se pudo mover/copiar', 'Ocurrió un error inesperado al ejecutar la acción.');
            }
        })();
    }, [actionStateRef, copyPatientToDateRef, moveOrCopyPatientRef, notifyErrorRef, recordRef, setActionState]);

    const executeDischarge = useCallback((data?: DischargeExecutionInput) => {
        const result = executeDischargeController({
            dischargeState: dischargeStateRef.current,
            data,
            stabilityRules: stabilityRulesRef.current,
            nowTime: getCurrentTime(),
            actions: {
                addDischarge: addDischargeRef.current,
                updateDischarge: updateDischargeRef.current
            }
        });

        if (!result.ok) {
            notifyErrorRef.current(getDischargeErrorTitle(result.error.code), result.error.message);
            return;
        }

        setDischargeState(prev => ({ ...prev, ...result.value.closeModalPatch }));
    }, [addDischargeRef, dischargeStateRef, getCurrentTime, notifyErrorRef, setDischargeState, stabilityRulesRef, updateDischargeRef]);

    const executeTransfer = useCallback((data?: TransferExecutionInput) => {
        const result = executeTransferController({
            transferState: transferStateRef.current,
            data,
            stabilityRules: stabilityRulesRef.current,
            nowTime: getCurrentTime(),
            actions: {
                addTransfer: addTransferRef.current,
                updateTransfer: updateTransferRef.current
            }
        });

        if (!result.ok) {
            notifyErrorRef.current(getTransferErrorTitle(result.error.code), result.error.message);
            return;
        }

        setTransferState(prev => ({ ...prev, ...result.value.closeModalPatch }));
    }, [addTransferRef, getCurrentTime, notifyErrorRef, setTransferState, stabilityRulesRef, transferStateRef, updateTransferRef]);

    return {
        executeMoveOrCopy,
        executeDischarge,
        executeTransfer,
        handleRowAction
    };
};
