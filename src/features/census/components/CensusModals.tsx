import React from 'react';
import { useStaffContext } from '@/context/StaffContext';
import { NurseManagerModal } from '@/components/modals/NurseManagerModal';
import { TensManagerModal } from '@/components/modals/TensManagerModal';
import { BedManagerModal } from '@/components/modals/BedManagerModal';
import { MoveCopyModal, DischargeModal, TransferModal } from '@/components/modals/ActionModals';
import {
    buildDischargeModalBinding,
    buildMoveCopyModalBinding,
    buildTransferModalBinding
} from '@/features/census/controllers/censusModalBindingsController';
import { useCensusModalsHandlers } from '@/features/census/hooks/useCensusModalsHandlers';

import { useCensusActionCommands, useCensusActionState } from './CensusActionsContext';

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
        actionState,
        setActionState,
        dischargeState,
        setDischargeState,
        transferState,
        setTransferState
    } = useCensusActionState();
    const { executeMoveOrCopy, executeDischarge, executeTransfer } = useCensusActionCommands();
    const modalBindings = {
        moveCopy: buildMoveCopyModalBinding(actionState),
        discharge: buildDischargeModalBinding(dischargeState),
        transfer: buildTransferModalBinding(transferState)
    };
    const {
        closeMoveCopy,
        setMoveCopyTarget,
        updateDischargeStatus,
        updateDischargeClinicalCribStatus,
        updateDischargeTarget,
        closeDischarge,
        updateTransfer,
        closeTransfer
    } = useCensusModalsHandlers({
        setActionState,
        setDischargeState,
        setTransferState
    });

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
                isOpen={modalBindings.moveCopy.isOpen}
                type={modalBindings.moveCopy.type}
                sourceBedId={modalBindings.moveCopy.sourceBedId}
                targetBedId={modalBindings.moveCopy.targetBedId}
                onClose={closeMoveCopy}
                onSetTarget={setMoveCopyTarget}
                onConfirm={executeMoveOrCopy}
            />

            <DischargeModal
                isOpen={modalBindings.discharge.isOpen}
                isEditing={modalBindings.discharge.isEditing}
                status={modalBindings.discharge.status}
                hasClinicalCrib={modalBindings.discharge.hasClinicalCrib}
                clinicalCribName={modalBindings.discharge.clinicalCribName}
                clinicalCribStatus={modalBindings.discharge.clinicalCribStatus}
                onClinicalCribStatusChange={updateDischargeClinicalCribStatus}
                onStatusChange={updateDischargeStatus}
                dischargeTarget={modalBindings.discharge.dischargeTarget}
                onDischargeTargetChange={updateDischargeTarget}
                initialType={modalBindings.discharge.initialType}
                initialOtherDetails={modalBindings.discharge.initialOtherDetails}
                initialTime={modalBindings.discharge.initialTime}
                onClose={closeDischarge}
                onConfirm={executeDischarge}
            />

            <TransferModal
                isOpen={modalBindings.transfer.isOpen}
                isEditing={modalBindings.transfer.isEditing}
                evacuationMethod={modalBindings.transfer.evacuationMethod}
                evacuationMethodOther={modalBindings.transfer.evacuationMethodOther}
                receivingCenter={modalBindings.transfer.receivingCenter}
                receivingCenterOther={modalBindings.transfer.receivingCenterOther}
                transferEscort={modalBindings.transfer.transferEscort}
                hasClinicalCrib={modalBindings.transfer.hasClinicalCrib}
                clinicalCribName={modalBindings.transfer.clinicalCribName}
                initialTime={modalBindings.transfer.initialTime}
                onUpdate={updateTransfer}
                onClose={closeTransfer}
                onConfirm={executeTransfer}
            />
        </>
    );
};
