import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { DischargeData, TransferData, PatientData } from '@/types';
import { EVACUATION_METHODS, RECEIVING_CENTERS } from '@/constants';
import { useDailyRecordData, useDailyRecordActions } from '@/context/DailyRecordContext';
import { useConfirmDialog } from '@/context/UIContext';
import { CensusManager } from '@/domain/CensusManager';

// --- Types ---

type ActionType = 'move' | 'copy' | null;

export interface ActionState {
    type: ActionType;
    sourceBedId: string | null;
    targetBedId: string | null;
}

export interface DischargeState {
    bedId: string | null;
    recordId?: string;
    isOpen: boolean;
    status: 'Vivo' | 'Fallecido';
    type?: string;
    typeOther?: string;
    time?: string;
    hasClinicalCrib?: boolean;
    clinicalCribName?: string;
    clinicalCribStatus?: 'Vivo' | 'Fallecido';
    dischargeTarget?: 'mother' | 'baby' | 'both';
}

export interface TransferState {
    bedId: string | null;
    recordId?: string;
    isOpen: boolean;
    evacuationMethod: string;
    evacuationMethodOther: string;
    receivingCenter: string;
    receivingCenterOther: string;
    transferEscort: string;
    time?: string;
    hasClinicalCrib?: boolean;
    clinicalCribName?: string;
}

interface CensusActionsContextType {
    // Move/Copy State
    actionState: ActionState;
    setActionState: (state: ActionState) => void;
    executeMoveOrCopy: () => void;

    // Discharge State
    dischargeState: DischargeState;
    setDischargeState: (state: DischargeState) => void;
    executeDischarge: (data?: { status: 'Vivo' | 'Fallecido', type?: string, typeOther?: string, time?: string, dischargeTarget?: 'mother' | 'baby' | 'both' }) => void;
    handleEditDischarge: (d: DischargeData) => void;

    // Transfer State
    transferState: TransferState;
    setTransferState: (state: TransferState) => void;
    executeTransfer: (data?: { time?: string }) => void;
    handleEditTransfer: (t: TransferData) => void;

    // Row Action Handler
    handleRowAction: (action: 'clear' | 'copy' | 'move' | 'discharge' | 'transfer' | 'cma', bedId: string, patient: PatientData) => void;
}

const CensusActionsContext = createContext<CensusActionsContextType | undefined>(undefined);

// --- Provider ---

interface CensusActionsProviderProps {
    children: ReactNode;
}

export const CensusActionsProvider: React.FC<CensusActionsProviderProps> = ({ children }) => {
    const { record, stabilityRules } = useDailyRecordData();
    const {
        clearPatient,
        moveOrCopyPatient,
        addDischarge,
        updateDischarge,
        addTransfer,
        updateTransfer,
        addCMA,
        copyPatientToDate
    } = useDailyRecordActions();

    const { confirm } = useConfirmDialog();

    // Action State (move/copy)
    const [actionState, setActionState] = useState<ActionState>({
        type: null,
        sourceBedId: null,
        targetBedId: null
    });

    // Discharge State
    const [dischargeState, setDischargeState] = useState<DischargeState>({
        bedId: null,
        isOpen: false,
        status: 'Vivo'
    });

    // Transfer State
    const [transferState, setTransferState] = useState<TransferState>({
        bedId: null,
        isOpen: false,
        evacuationMethod: EVACUATION_METHODS[0],
        evacuationMethodOther: '',
        receivingCenter: RECEIVING_CENTERS[0],
        receivingCenterOther: '',
        transferEscort: 'Enfermera'
    });

    // --- Handlers ---

    const handleRowAction = useCallback(async (action: 'clear' | 'copy' | 'move' | 'discharge' | 'transfer' | 'cma', bedId: string, patient: PatientData) => {
        if (!stabilityRules.canPerformActions) {
            alert(stabilityRules.lockReason || 'Este registro está bloqueado para ediciones.');
            return;
        }

        switch (action) {
            case 'clear': {
                const confirmedClear = await confirm({
                    title: 'Limpiar cama',
                    message: '¿Está seguro de limpiar los datos de esta cama?',
                    confirmText: 'Sí, limpiar',
                    variant: 'warning'
                });
                if (confirmedClear) clearPatient(bedId);
                break;
            }

            case 'copy':
            case 'move':
                setActionState({ type: action, sourceBedId: bedId, targetBedId: null });
                break;

            case 'discharge':
                setDischargeState(prev => ({
                    ...prev,
                    ...CensusManager.prepareDischarge(patient, bedId)
                }));
                break;

            case 'transfer':
                setTransferState(prev => ({
                    ...prev,
                    ...CensusManager.prepareTransfer(patient, bedId, {
                        evacuation: EVACUATION_METHODS[0],
                        center: RECEIVING_CENTERS[0]
                    })
                }));
                break;

            case 'cma': {
                if (!patient.patientName) return;
                const confirmedCMA = await confirm({
                    title: 'Egreso CMA',
                    message: `¿Registrar a ${patient.patientName} como egreso de Hospitalización Diurna (CMA)?`,
                    variant: 'warning'
                });

                if (confirmedCMA) {
                    addCMA(CensusManager.formatCMAData(patient, bedId) as any);
                    clearPatient(bedId);
                }
                break;
            }
        }
    }, [confirm, clearPatient, addCMA, stabilityRules]);

    const executeMoveOrCopy = useCallback((targetDate?: string) => {
        const validation = CensusManager.validateMovement(actionState, record!);
        if (!validation.isValid) {
            alert(validation.error);
            return;
        }

        if (actionState.type === 'copy' && targetDate) {
            copyPatientToDate(actionState.sourceBedId!, targetDate, actionState.targetBedId!);
        } else {
            moveOrCopyPatient(actionState.type!, actionState.sourceBedId!, actionState.targetBedId!);
        }
        setActionState({ type: null, sourceBedId: null, targetBedId: null });
    }, [actionState, moveOrCopyPatient, copyPatientToDate, record]);

    const executeDischarge = useCallback((data?: { status: 'Vivo' | 'Fallecido', type?: string, typeOther?: string, time?: string, dischargeTarget?: 'mother' | 'baby' | 'both' }) => {
        if (!stabilityRules.canPerformActions && !dischargeState.recordId) {
            alert(stabilityRules.lockReason || 'Acción bloqueada.');
            return;
        }

        // If data is provided (from Modal onConfirm), use it. Fallback to state (legacy/editing)
        const status = data?.status || dischargeState.status;
        const type = data?.type;
        const typeOther = data?.typeOther;
        const time = data?.time || dischargeState.time || new Date().toTimeString().slice(0, 5);
        const target = data?.dischargeTarget || dischargeState.dischargeTarget;

        if (dischargeState.recordId) {
            updateDischarge(
                dischargeState.recordId,
                status,
                type,
                typeOther,
                time
            );
        } else if (dischargeState.bedId) {
            addDischarge(
                dischargeState.bedId,
                status,
                dischargeState.clinicalCribStatus,
                type,
                typeOther,
                time,
                target
            );
        }
        setDischargeState(prev => ({ ...prev, isOpen: false }));
    }, [dischargeState, updateDischarge, addDischarge, stabilityRules]);

    const executeTransfer = useCallback((data?: { time?: string }) => {
        if (!stabilityRules.canPerformActions && !transferState.recordId) {
            alert(stabilityRules.lockReason || 'Acción bloqueada.');
            return;
        }

        const time = data?.time || transferState.time || new Date().toTimeString().slice(0, 5);
        if (transferState.recordId) {
            updateTransfer(transferState.recordId, {
                evacuationMethod: transferState.evacuationMethod,
                receivingCenter: transferState.receivingCenter,
                receivingCenterOther: transferState.receivingCenterOther,
                transferEscort: transferState.transferEscort,
                time
            });
        } else if (transferState.bedId) {
            addTransfer(
                transferState.bedId,
                transferState.evacuationMethod,
                transferState.receivingCenter,
                transferState.receivingCenterOther,
                transferState.transferEscort,
                time
            );
        }
        setTransferState(prev => ({ ...prev, isOpen: false }));
    }, [transferState, updateTransfer, addTransfer, stabilityRules]);

    const handleEditDischarge = useCallback((d: DischargeData) => {
        setDischargeState({
            bedId: null,
            recordId: d.id,
            isOpen: true,
            status: d.status,
            type: d.dischargeType,
            typeOther: d.dischargeTypeOther,
            time: d.time
        });
    }, []);

    const handleEditTransfer = useCallback((t: TransferData) => {
        setTransferState({
            bedId: null,
            recordId: t.id,
            isOpen: true,
            evacuationMethod: t.evacuationMethod,
            evacuationMethodOther: '',
            receivingCenter: t.receivingCenter,
            receivingCenterOther: t.receivingCenterOther || '',
            transferEscort: t.transferEscort || 'Enfermera',
            time: t.time
        });
    }, []);

    const value: CensusActionsContextType = {
        actionState,
        setActionState,
        executeMoveOrCopy,
        dischargeState,
        setDischargeState,
        executeDischarge,
        handleEditDischarge,
        transferState,
        setTransferState,
        executeTransfer,
        handleEditTransfer,
        handleRowAction
    };

    return (
        <CensusActionsContext.Provider value={value}>
            {children}
        </CensusActionsContext.Provider>
    );
};

// --- Hook ---

export const useCensusActions = (): CensusActionsContextType => {
    const context = useContext(CensusActionsContext);
    if (!context) {
        throw new Error('useCensusActions must be used within a CensusActionsProvider');
    }
    return context;
};
