import React, {
    createContext,
    useContext,
    useState,
    ReactNode,
    useCallback,
    Dispatch,
    SetStateAction,
    useMemo
} from 'react';
import { DischargeData, TransferData, PatientData } from '@/types';
import { useDailyRecordData, useDailyRecordActions } from '@/context/DailyRecordContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { PatientRowAction } from '@/features/census/components/patient-row/patientActionMenuConfig';
import {
    buildDischargeEditState,
    buildTransferEditState
} from '@/features/census/controllers/censusEditStateController';
import {
    DischargeExecutionInput,
    TransferExecutionInput
} from '@/features/census/controllers/censusActionExecutionController';
import {
    ActionState,
    createInitialActionState,
    createInitialDischargeState,
    createInitialTransferState,
    DischargeState,
    TransferState
} from '@/features/census/types/censusActionTypes';
import { useLatestRef } from '@/features/census/hooks/useLatestRef';
import { useCensusActionCommandsController } from '@/features/census/hooks/useCensusActionCommandsController';

interface CensusActionStateContextType {
    actionState: ActionState;
    setActionState: Dispatch<SetStateAction<ActionState>>;
    dischargeState: DischargeState;
    setDischargeState: Dispatch<SetStateAction<DischargeState>>;
    transferState: TransferState;
    setTransferState: Dispatch<SetStateAction<TransferState>>;
}

interface CensusActionCommandsContextType {
    executeMoveOrCopy: (targetDate?: string) => void;
    executeDischarge: (data?: DischargeExecutionInput) => void;
    handleEditDischarge: (d: DischargeData) => void;
    executeTransfer: (data?: TransferExecutionInput) => void;
    handleEditTransfer: (t: TransferData) => void;
    handleRowAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
}

const CensusActionStateContext = createContext<CensusActionStateContextType | undefined>(undefined);
const CensusActionCommandsContext = createContext<CensusActionCommandsContextType | undefined>(undefined);

const getCurrentTime = (): string => new Date().toTimeString().slice(0, 5);

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
    const { error: notifyError } = useNotification();

    const [actionState, setActionState] = useState<ActionState>(createInitialActionState);
    const [dischargeState, setDischargeState] = useState<DischargeState>(createInitialDischargeState);
    const [transferState, setTransferState] = useState<TransferState>(createInitialTransferState);

    const actionStateRef = useLatestRef(actionState);
    const dischargeStateRef = useLatestRef(dischargeState);
    const transferStateRef = useLatestRef(transferState);
    const recordRef = useLatestRef(record);
    const stabilityRulesRef = useLatestRef(stabilityRules);
    const clearPatientRef = useLatestRef(clearPatient);
    const moveOrCopyPatientRef = useLatestRef(moveOrCopyPatient);
    const addDischargeRef = useLatestRef(addDischarge);
    const updateDischargeRef = useLatestRef(updateDischarge);
    const addTransferRef = useLatestRef(addTransfer);
    const updateTransferRef = useLatestRef(updateTransfer);
    const addCmaRef = useLatestRef(addCMA);
    const copyPatientToDateRef = useLatestRef(copyPatientToDate);
    const confirmRef = useLatestRef(confirm);
    const notifyErrorRef = useLatestRef(notifyError);
    const {
        executeMoveOrCopy,
        executeDischarge,
        executeTransfer,
        handleRowAction
    } = useCensusActionCommandsController({
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
    });

    const handleEditDischarge = useCallback((d: DischargeData) => {
        setDischargeState(buildDischargeEditState(d));
    }, []);

    const handleEditTransfer = useCallback((t: TransferData) => {
        setTransferState(buildTransferEditState(t));
    }, []);

    const stateValue = useMemo<CensusActionStateContextType>(() => ({
        actionState,
        setActionState,
        dischargeState,
        setDischargeState,
        transferState,
        setTransferState
    }), [actionState, dischargeState, transferState]);

    const commandsValue = useMemo<CensusActionCommandsContextType>(() => ({
        executeMoveOrCopy,
        executeDischarge,
        handleEditDischarge,
        executeTransfer,
        handleEditTransfer,
        handleRowAction
    }), [
        executeMoveOrCopy,
        executeDischarge,
        handleEditDischarge,
        executeTransfer,
        handleEditTransfer,
        handleRowAction
    ]);

    return (
        <CensusActionCommandsContext.Provider value={commandsValue}>
            <CensusActionStateContext.Provider value={stateValue}>
                {children}
            </CensusActionStateContext.Provider>
        </CensusActionCommandsContext.Provider>
    );
};

export const useCensusActionState = (): CensusActionStateContextType => {
    const context = useContext(CensusActionStateContext);
    if (!context) {
        throw new Error('useCensusActionState must be used within a CensusActionsProvider');
    }
    return context;
};

export const useCensusActionCommands = (): CensusActionCommandsContextType => {
    const context = useContext(CensusActionCommandsContext);
    if (!context) {
        throw new Error('useCensusActionCommands must be used within a CensusActionsProvider');
    }
    return context;
};

export const useCensusActions = (): CensusActionStateContextType & CensusActionCommandsContextType => {
    const state = useCensusActionState();
    const commands = useCensusActionCommands();

    return useMemo(() => ({ ...state, ...commands }), [state, commands]);
};
