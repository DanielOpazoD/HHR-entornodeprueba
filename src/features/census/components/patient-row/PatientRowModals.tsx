import React, { lazy, Suspense } from 'react';
import { buildPatientRowModalRenderModel } from '@/features/census/controllers/patientRowModalRenderController';
import type { PatientRowModalsProps } from '@/features/census/components/patient-row/patientRowContracts';
import { hasMeaningfulDemographicSubset } from '@/components/modals/demographics/utils';

const LazyDemographicsModal = lazy(() =>
  import('@/components/modals/DemographicsModal').then(module => ({
    default: module.DemographicsModal,
  }))
);

const LazyExamRequestModal = lazy(() =>
  import('@/components/modals/ExamRequestModal').then(module => ({
    default: module.ExamRequestModal,
  }))
);

const LazyImagingRequestDialog = lazy(() =>
  import('@/components/modals/ImagingRequestDialog').then(module => ({
    default: module.ImagingRequestDialog,
  }))
);

const LazyPatientHistoryModal = lazy(() =>
  import('@/components/modals/PatientHistoryModal').then(module => ({
    default: module.PatientHistoryModal,
  }))
);

const LazyClinicalDocumentsModal = lazy(() =>
  import('@/features/clinical-documents').then(module => ({
    default: module.ClinicalDocumentsModal,
  }))
);

export const PatientRowModals: React.FC<PatientRowModalsProps> = ({
  bedId,
  data,
  currentDateString,
  isSubRow,
  showDemographics,
  showClinicalDocuments,
  canOpenClinicalDocuments,
  showExamRequest,
  canOpenExamRequest,
  showImagingRequest,
  canOpenImagingRequest,
  showHistory,
  canOpenHistory,
  onCloseDemographics,
  onCloseClinicalDocuments,
  onCloseExamRequest,
  onCloseImagingRequest,
  onCloseHistory,
  onSaveDemographics,
  onSaveCribDemographics,
  onRevertEmptyDemographics,
  canUseArbitraryAdmissionDate = false,
}) => {
  const {
    demographicsBinding,
    visibilityState,
    demographicsKey,
    historyPatientRut,
    historyPatientName,
  } = buildPatientRowModalRenderModel({
    bedId,
    data,
    isSubRow,
    showDemographics,
    showClinicalDocuments,
    canOpenClinicalDocuments,
    showExamRequest,
    canOpenExamRequest,
    showImagingRequest,
    canOpenImagingRequest,
    showHistory,
    canOpenHistory,
    onSaveDemographics,
    onSaveCribDemographics,
  });

  const maybeRevertEmptyDemographics = React.useCallback(() => {
    if (isSubRow || hasMeaningfulDemographicSubset(data)) {
      return;
    }

    onRevertEmptyDemographics();
  }, [data, isSubRow, onRevertEmptyDemographics]);

  return (
    <>
      {visibilityState.shouldRenderDemographics ? (
        <Suspense fallback={null}>
          <LazyDemographicsModal
            key={demographicsKey}
            isOpen={showDemographics}
            onClose={onCloseDemographics}
            onCancel={maybeRevertEmptyDemographics}
            onEmptySave={maybeRevertEmptyDemographics}
            data={data}
            onSave={demographicsBinding.onSave}
            bedId={demographicsBinding.targetBedId}
            recordDate={currentDateString}
            isClinicalCribPatient={demographicsBinding.isRnIdentityContext}
            requiresCompleteDemographics={!isSubRow && !hasMeaningfulDemographicSubset(data)}
            canUseArbitraryAdmissionDate={canUseArbitraryAdmissionDate}
          />
        </Suspense>
      ) : null}

      {visibilityState.shouldRenderExamRequest && (
        <Suspense fallback={null}>
          <LazyExamRequestModal
            key={`exam-request-${bedId}-${showExamRequest}`}
            isOpen={showExamRequest}
            onClose={onCloseExamRequest}
            patient={data}
            recordDate={currentDateString}
          />
        </Suspense>
      )}

      {visibilityState.shouldRenderImagingRequest ? (
        <Suspense fallback={null}>
          <LazyImagingRequestDialog
            isOpen={showImagingRequest}
            onClose={onCloseImagingRequest}
            patient={data}
          />
        </Suspense>
      ) : null}

      {visibilityState.shouldRenderClinicalDocuments ? (
        <Suspense fallback={null}>
          <LazyClinicalDocumentsModal
            isOpen={showClinicalDocuments}
            onClose={onCloseClinicalDocuments}
            patient={data}
            currentDateString={currentDateString}
            bedId={bedId}
          />
        </Suspense>
      ) : null}

      {visibilityState.shouldRenderHistory ? (
        <Suspense fallback={null}>
          <LazyPatientHistoryModal
            isOpen={showHistory}
            onClose={onCloseHistory}
            patientRut={historyPatientRut}
            patientName={historyPatientName}
          />
        </Suspense>
      ) : null}
    </>
  );
};
