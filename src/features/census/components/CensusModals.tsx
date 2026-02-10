import React from 'react';
import { useStaffContext } from '@/context/StaffContext';
import { NurseManagerModal } from '@/components/modals/NurseManagerModal';
import { TensManagerModal } from '@/components/modals/TensManagerModal';
import { BedManagerModal } from '@/components/modals/BedManagerModal';
import { MoveCopyModal, DischargeModal, TransferModal } from '@/components/modals/ActionModals';

import { useCensusActions } from './CensusActionsContext';

interface CensusModalsProps {
    showBedManagerModal: boolean;
    onCloseBedManagerModal: () => void;
}

export const CensusModals: React.FC<CensusModalsProps> = ({
    showBedManagerModal,
    onCloseBedManagerModal
}) => {
    // Staff management from StaffContext
    const {
        nursesList,
        tensList,
        showNurseManager,
        setShowNurseManager,
        showTensManager,
        setShowTensManager
    } = useStaffContext();

    const {
        // Move/Copy
        actionState,
        setActionState,
        executeMoveOrCopy,

        // Discharge
        dischargeState,
        setDischargeState,
        executeDischarge,

        // Transfer
        transferState,
        setTransferState,
        executeTransfer
    } = useCensusActions();

    return (
        <>
            <NurseManagerModal
                isOpen={showNurseManager}
                onClose={() => setShowNurseManager(false)}
                nursesList={nursesList}
            />

            <TensManagerModal
                isOpen={showTensManager}
                onClose={() => setShowTensManager(false)}
                tensList={tensList}
            />

            <BedManagerModal
                isOpen={showBedManagerModal}
                onClose={onCloseBedManagerModal}
            />

            <MoveCopyModal
                isOpen={actionState.type !== null}
                type={actionState.type || 'move'}
                sourceBedId={actionState.sourceBedId || ''}
                targetBedId={actionState.targetBedId || ''}
                onClose={() => setActionState({ type: null, sourceBedId: null, targetBedId: null })}
                onSetTarget={(id) => setActionState({ ...actionState, targetBedId: id })}
                onConfirm={executeMoveOrCopy}
            />

            <DischargeModal
                isOpen={dischargeState.isOpen}
                isEditing={!!dischargeState.recordId}
                status={dischargeState.status}
                hasClinicalCrib={dischargeState.hasClinicalCrib}
                clinicalCribName={dischargeState.clinicalCribName}
                clinicalCribStatus={dischargeState.clinicalCribStatus}
                onClinicalCribStatusChange={(s) => setDischargeState({ ...dischargeState, clinicalCribStatus: s })}
                onStatusChange={(s) => setDischargeState({ ...dischargeState, status: s })}
                dischargeTarget={dischargeState.dischargeTarget}
                onDischargeTargetChange={(t) => setDischargeState({ ...dischargeState, dischargeTarget: t })}
                initialType={dischargeState.type}
                initialOtherDetails={dischargeState.typeOther}
                initialTime={dischargeState.time}
                onClose={() => setDischargeState({ ...dischargeState, isOpen: false })}
                onConfirm={executeDischarge}
            />

            <TransferModal
                isOpen={transferState.isOpen}
                isEditing={!!transferState.recordId}
                evacuationMethod={transferState.evacuationMethod}
                evacuationMethodOther={transferState.evacuationMethodOther || ''}
                receivingCenter={transferState.receivingCenter}
                receivingCenterOther={transferState.receivingCenterOther}
                transferEscort={transferState.transferEscort}
                hasClinicalCrib={transferState.hasClinicalCrib}
                clinicalCribName={transferState.clinicalCribName}
                initialTime={transferState.time}
                onUpdate={(field, val) => {
                    const updates: Record<string, string | boolean> = { [field]: val };
                    if (field === 'evacuationMethod' && val === 'Aerocardal') {
                        updates.transferEscort = '';
                    }
                    setTransferState({ ...transferState, ...updates } as any);
                }}
                onClose={() => setTransferState({ ...transferState, isOpen: false })}
                onConfirm={executeTransfer}
            />
        </>
    );
};
