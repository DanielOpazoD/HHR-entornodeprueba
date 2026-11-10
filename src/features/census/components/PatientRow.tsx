import React, { Suspense, lazy } from 'react';
import { resolvePatientRowModalMountState } from '@/features/census/controllers/patientRowModalRenderController';

// Sub-components
import { PatientSubRowView } from './patient-row/PatientSubRowView';
import { PatientMainRowView } from './patient-row/PatientMainRowView';
import { usePatientRowBindingsModel } from './patient-row/usePatientRowBindingsModel';
import type { PatientRowProps } from './patient-row/patientRowContracts';

const LazyPatientRowModals = lazy(() =>
  import('./patient-row/PatientRowModals').then(module => ({
    default: module.PatientRowModals,
  }))
);

const PatientRowComponent: React.FC<PatientRowProps> = ({
  bed,
  data,
  currentDateString,
  getRecordLastUpdated,
  onAction,
  readOnly = false,
  clinicalEditingDisabled = false,
  actionMenuAlign = 'top',
  diagnosisMode = 'free',
  isSubRow = false,
  bedType,
  role,
  accessProfile = 'default',
  indicators,
  style,
  isPendingClear = false,
  clinicalDocumentCount,
}) => {
  const bindings = usePatientRowBindingsModel({
    bed,
    bedType,
    data,
    currentDateString,
    getRecordLastUpdated,
    onAction,
    readOnly,
    clinicalEditingDisabled,
    actionMenuAlign,
    diagnosisMode,
    isSubRow,
    role,
    accessProfile,
    style,
    indicators,
  });

  // EARLY RETURN ONLY AFTER ALL HOOKS
  if (!data) return null;

  const shouldRenderModals = resolvePatientRowModalMountState(
    bindings.modalsProps
  ).shouldRenderAnyModal;

  return (
    <>
      {isSubRow ? (
        <PatientSubRowView
          {...bindings.subRowProps}
          parentBedId={bed.id}
          isPendingClear={isPendingClear}
        />
      ) : (
        <PatientMainRowView
          {...bindings.mainRowProps}
          isPendingClear={isPendingClear}
          clinicalDocumentCount={clinicalDocumentCount}
        />
      )}

      {shouldRenderModals ? (
        <Suspense fallback={null}>
          <LazyPatientRowModals {...bindings.modalsProps} />
        </Suspense>
      ) : null}
    </>
  );
};

export const PatientRow = React.memo(PatientRowComponent);
