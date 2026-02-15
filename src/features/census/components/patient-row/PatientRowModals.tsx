import React from 'react';
import { DemographicsModal } from '@/components/modals/DemographicsModal';
import { ExamRequestModal } from '@/components/modals/ExamRequestModal';
import { PatientHistoryModal } from '@/components/modals/PatientHistoryModal';
import { resolvePatientRowDemographicsBinding } from '@/features/census/controllers/patientRowModalController';
import type { PatientRowModalsProps } from '@/features/census/components/patient-row/patientRowViewContracts';

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
  onSaveCribDemographics,
}) => {
  const demographicsBinding = resolvePatientRowDemographicsBinding({
    bedId,
    isSubRow,
    onSaveDemographics,
    onSaveCribDemographics,
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
