import React from 'react';
import { PatientData } from '@/types';
import { DemographicsModal } from '@/components/modals/DemographicsModal';
import { ExamRequestModal } from '@/components/modals/ExamRequestModal';
import { PatientHistoryModal } from '@/components/modals/PatientHistoryModal';
import { resolvePatientRowDemographicsBinding } from '@/features/census/controllers/patientRowModalController';

interface PatientRowModalsProps {
    bedId: string;
    data: PatientData;
    currentDateString: string;
    isSubRow: boolean;
    showDemographics: boolean;
    showExamRequest: boolean;
    showHistory: boolean;
    onCloseDemographics: () => void;
    onCloseExamRequest: () => void;
    onCloseHistory: () => void;
    onSaveDemographics: (fields: Partial<PatientData>) => void;
    onSaveCribDemographics: (fields: Partial<PatientData>) => void;
}

export const PatientRowModals: React.FC<PatientRowModalsProps> = ({
    bedId,
    data,
    currentDateString,
    isSubRow,
    showDemographics,
    showExamRequest,
    showHistory,
    onCloseDemographics,
    onCloseExamRequest,
    onCloseHistory,
    onSaveDemographics,
    onSaveCribDemographics
}) => {
    const demographicsBinding = resolvePatientRowDemographicsBinding({
        bedId,
        isSubRow,
        onSaveDemographics,
        onSaveCribDemographics
    });

    return (
        <>
            <DemographicsModal
                isOpen={showDemographics}
                onClose={onCloseDemographics}
                data={data}
                onSave={demographicsBinding.onSave}
                bedId={demographicsBinding.targetBedId}
                recordDate={currentDateString}
            />

            {showExamRequest && (
                <ExamRequestModal
                    key={`exam-request-${bedId}-${showExamRequest}`}
                    isOpen={showExamRequest}
                    onClose={onCloseExamRequest}
                    patient={data}
                />
            )}

            <PatientHistoryModal
                isOpen={showHistory}
                onClose={onCloseHistory}
                patientRut={data.rut || ''}
                patientName={data.patientName}
            />
        </>
    );
};
