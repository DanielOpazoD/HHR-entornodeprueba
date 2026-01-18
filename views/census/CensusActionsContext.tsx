import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { DischargeData, TransferData } from '@/types';
import { EVACUATION_METHODS, RECEIVING_CENTERS } from '@/constants';
import { useDailyRecordData, useDailyRecordActions } from '@/context/DailyRecordContext';
import { useConfirmDialog } from '@/context/UIContext';

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
    handleRowAction: (action: 'clear' | 'copy' | 'move' | 'discharge' | 'transfer', bedId: string) => void;
}

const CensusActionsContext = createContext<CensusActionsContextType | undefined>(undefined);

// --- Provider ---

interface CensusActionsProviderProps {
    children: ReactNode;
}

export const CensusActionsProvider: React.FC<CensusActionsProviderProps> = ({ children }) => {
    const { record } = useDailyRecordData();
    const {
        clearPatient,
        moveOrCopyPatient,
        addDischarge,
        updateDischarge,
        addTransfer,
        updateTransfer
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
        receivingCenter: RECEIVING_CENTERS[0],
        receivingCenterOther: '',
        transferEscort: 'Enfermera'
    });

    // --- Handlers ---

    const handleRowAction = useCallback(async (action: 'clear' | 'copy' | 'move' | 'discharge' | 'transfer', bedId: string) => {
        if (!record) return;

        if (action === 'clear') {
            const confirmed = await confirm({
                title: 'Limpiar cama',
                message: '¿Está seguro de limpiar los datos de esta cama?',
                confirmText: 'Sí, limpiar',
                cancelText: 'Cancelar',
                variant: 'warning'
            });
            if (confirmed) {
                clearPatient(bedId);
            }
        } else if (action === 'copy' || action === 'move') {
            setActionState({ type: action, sourceBedId: bedId, targetBedId: null });
        } else if (action === 'discharge') {
            const patient = record.beds[bedId];
            const hasBaby = !!patient.clinicalCrib;
            setDischargeState({
                bedId,
                recordId: undefined,
                isOpen: true,
                status: 'Vivo',
                hasClinicalCrib: hasBaby,
                clinicalCribName: patient.clinicalCrib?.patientName,
                clinicalCribStatus: 'Vivo',
                time: undefined,
                dischargeTarget: hasBaby ? 'both' : undefined
            });
        } else if (action === 'transfer') {
            const patient = record.beds[bedId];
            const hasBaby = !!patient.clinicalCrib;
            setTransferState({
                bedId,
                recordId: undefined,
                isOpen: true,
                evacuationMethod: EVACUATION_METHODS[0],
                receivingCenter: RECEIVING_CENTERS[0],
                receivingCenterOther: '',
                transferEscort: 'Enfermera',
                time: undefined,
                hasClinicalCrib: hasBaby,
                clinicalCribName: patient.clinicalCrib?.patientName
            });
        }
    }, [record, confirm, clearPatient]);

    const executeMoveOrCopy = useCallback(() => {
        if (!actionState.sourceBedId || !actionState.targetBedId || !actionState.type) return;
        moveOrCopyPatient(actionState.type, actionState.sourceBedId, actionState.targetBedId);
        setActionState({ type: null, sourceBedId: null, targetBedId: null });
    }, [actionState, moveOrCopyPatient]);

    const executeDischarge = useCallback((data?: { status: 'Vivo' | 'Fallecido', type?: string, typeOther?: string, time?: string, dischargeTarget?: 'mother' | 'baby' | 'both' }) => {
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
    }, [dischargeState, updateDischarge, addDischarge]);

    const executeTransfer = useCallback((data?: { time?: string }) => {
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
    }, [transferState, updateTransfer, addTransfer]);

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
