import React from 'react';

// Sub-components
import { PatientSubRowView } from './patient-row/PatientSubRowView';
import { PatientMainRowView } from './patient-row/PatientMainRowView';
import { PatientRowModals } from './patient-row/PatientRowModals';
import { usePatientRowBindingsModel } from './patient-row/usePatientRowBindingsModel';
import type { PatientRowProps } from './patient-row/patientRowViewContracts';

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
  style,
}) => {
  const bindings = usePatientRowBindingsModel({
    bed,
    bedType,
    data,
    currentDateString,
    onAction,
    readOnly,
    actionMenuAlign,
    diagnosisMode,
    isSubRow,
    style,
  });

  // EARLY RETURN ONLY AFTER ALL HOOKS
  if (!data) return null;

  return (
    <>
      {isSubRow ? (
        <PatientSubRowView {...bindings.subRowProps} />
      ) : (
        <PatientMainRowView {...bindings.mainRowProps} />
      )}

      <PatientRowModals {...bindings.modalsProps} />
    </>
  );
};

export const PatientRow = React.memo(PatientRowComponent);
