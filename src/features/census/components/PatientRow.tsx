import React, { useCallback, useMemo } from 'react';
import { BedDefinition, PatientData, BedType } from '@/types';
import { useDailyRecordActions } from '@/context/DailyRecordContext';
import { useConfirmDialog } from '@/context/UIContext';
import { DiagnosisMode } from '@/features/census/components/CensusTable';
import { PatientRowAction } from '@/features/census/components/patient-row/patientActionMenuConfig';

// Sub-components
import { usePatientRowBedConfigActions } from './patient-row/usePatientRowBedConfigActions';
import {
    usePatientRowCribInputHandlers,
    usePatientRowMainInputHandlers
} from './patient-row/usePatientRowInputHandlers';
import { usePatientRowUiState } from './patient-row/usePatientRowUiState';
import { PatientSubRowView } from './patient-row/PatientSubRowView';
import { PatientMainRowView } from './patient-row/PatientMainRowView';
import { PatientRowModals } from './patient-row/PatientRowModals';
import { derivePatientRowState } from '@/features/census/controllers/patientRowStateController';
import type { ClinicalCribInputChangeHandlers, PatientInputChangeHandlers } from './patient-row/inputCellTypes';
import type { RowMenuAlign } from './patient-row/patientRowContracts';

interface PatientRowProps {
    bed: BedDefinition;
    data: PatientData;
    currentDateString: string;
    onAction: (action: PatientRowAction, bedId: string, patient: PatientData) => void;
    readOnly?: boolean;
    actionMenuAlign?: RowMenuAlign;
    diagnosisMode?: DiagnosisMode;
    isSubRow?: boolean;
    bedType: BedType;
    style?: React.CSSProperties;
}

const PatientRowComponent: React.FC<PatientRowProps> = ({
    bed,
    data,
    currentDateString,
    onAction,
    readOnly = false,
    actionMenuAlign = 'top',
    diagnosisMode = 'free',
    isSubRow = false,
    bedType,
    style
}) => {
    const { updatePatient, updatePatientMultiple, updateClinicalCrib, updateClinicalCribMultiple, toggleBedType } = useDailyRecordActions();
    const { confirm, alert } = useConfirmDialog();
    const uiState = usePatientRowUiState();

    const {
        handleTextChange,
        handleCheckboxChange,
        handleDevicesChange,
        handleDeviceDetailsChange,
        handleDeviceHistoryChange,
        handleDemographicsSave,
        toggleDocumentType,
        handleDeliveryRouteChange
    } = usePatientRowMainInputHandlers({
        bedId: bed.id,
        documentType: data?.documentType,
        updatePatient,
        updatePatientMultiple
    });

    const {
        handleCribTextChange,
        handleCribCheckboxChange,
        handleCribDevicesChange,
        handleCribDeviceDetailsChange,
        handleCribDeviceHistoryChange,
        handleCribDemographicsSave
    } = usePatientRowCribInputHandlers({
        bedId: bed.id,
        updateClinicalCrib,
        updateClinicalCribMultiple
    });

    const rowState = derivePatientRowState(data);

    const {
        toggleBedMode,
        toggleCompanionCrib,
        toggleClinicalCrib
    } = usePatientRowBedConfigActions({
        bedId: bed.id,
        isCunaMode: rowState.isCunaMode,
        hasCompanion: rowState.hasCompanion,
        hasClinicalCrib: rowState.hasClinicalCrib,
        updatePatient,
        updateClinicalCrib,
        confirm,
        alert
    });

    const handleAction = useCallback((action: PatientRowAction) => {
        onAction(action, bed.id, data);
    }, [onAction, bed.id, data]);

    const cribInputChangeHandlers = useMemo<ClinicalCribInputChangeHandlers>(() => ({
        text: handleCribTextChange,
        check: handleCribCheckboxChange,
        devices: handleCribDevicesChange,
        deviceDetails: handleCribDeviceDetailsChange,
        deviceHistory: handleCribDeviceHistoryChange,
        multiple: handleCribDemographicsSave
    }), [
        handleCribCheckboxChange,
        handleCribDemographicsSave,
        handleCribDeviceDetailsChange,
        handleCribDeviceHistoryChange,
        handleCribDevicesChange,
        handleCribTextChange
    ]);
    const mainInputChangeHandlers = useMemo<PatientInputChangeHandlers>(() => ({
        text: handleTextChange,
        check: handleCheckboxChange,
        devices: handleDevicesChange,
        deviceDetails: handleDeviceDetailsChange,
        deviceHistory: handleDeviceHistoryChange,
        toggleDocType: toggleDocumentType,
        deliveryRoute: handleDeliveryRouteChange,
        multiple: handleDemographicsSave
    }), [
        handleCheckboxChange,
        handleDeliveryRouteChange,
        handleDemographicsSave,
        handleDeviceDetailsChange,
        handleDeviceHistoryChange,
        handleDevicesChange,
        handleTextChange,
        toggleDocumentType
    ]);

    // EARLY RETURN ONLY AFTER ALL HOOKS
    if (!data) return null;

    return (
        <>
            {isSubRow ? (
                <PatientSubRowView
                    data={data}
                    currentDateString={currentDateString}
                    readOnly={readOnly}
                    style={style}
                    onOpenDemographics={uiState.openDemographics}
                    onChange={cribInputChangeHandlers}
                />
            ) : (
                <PatientMainRowView
                    bed={bed}
                    bedType={bedType}
                    data={data}
                    currentDateString={currentDateString}
                    style={style}
                    readOnly={readOnly}
                    actionMenuAlign={actionMenuAlign}
                    diagnosisMode={diagnosisMode}
                    isBlocked={rowState.isBlocked}
                    isEmpty={rowState.isEmpty}
                    hasCompanion={rowState.hasCompanion}
                    hasClinicalCrib={rowState.hasClinicalCrib}
                    isCunaMode={rowState.isCunaMode}
                    onAction={handleAction}
                    onOpenDemographics={uiState.openDemographics}
                    onOpenExamRequest={uiState.openExamRequest}
                    onOpenHistory={uiState.openHistory}
                    onToggleMode={toggleBedMode}
                    onToggleCompanion={toggleCompanionCrib}
                    onToggleClinicalCrib={toggleClinicalCrib}
                    onToggleBedType={() => toggleBedType(bed.id)}
                    onUpdateClinicalCrib={(action) => updateClinicalCrib(bed.id, action)}
                    onChange={mainInputChangeHandlers}
                />
            )}

            <PatientRowModals
                bedId={bed.id}
                data={data}
                currentDateString={currentDateString}
                isSubRow={isSubRow}
                showDemographics={uiState.showDemographics}
                showExamRequest={uiState.showExamRequest}
                showHistory={uiState.showHistory}
                onCloseDemographics={uiState.closeDemographics}
                onCloseExamRequest={uiState.closeExamRequest}
                onCloseHistory={uiState.closeHistory}
                onSaveDemographics={handleDemographicsSave}
                onSaveCribDemographics={handleCribDemographicsSave}
            />
        </>
    );
};

export const PatientRow = React.memo(PatientRowComponent);
