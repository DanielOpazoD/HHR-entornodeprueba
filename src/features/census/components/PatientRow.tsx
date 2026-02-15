import React from 'react';
import { BedDefinition, PatientData, BedType } from '@/types';
import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';
import type { PatientRowAction } from '@/features/census/types/patientRowActionTypes';

// Sub-components
import { PatientSubRowView } from './patient-row/PatientSubRowView';
import { PatientMainRowView } from './patient-row/PatientMainRowView';
import { PatientRowModals } from './patient-row/PatientRowModals';
import type { RowMenuAlign } from './patient-row/patientRowContracts';
import { usePatientRowRuntime } from './patient-row/usePatientRowRuntime';
import { buildPatientRowBindings } from '@/features/census/controllers/patientRowBindingsController';

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
  style,
}) => {
  const runtime = usePatientRowRuntime({ bed, data, onAction });
  const bindings = buildPatientRowBindings({
    bed,
    bedType,
    data,
    currentDateString,
    readOnly,
    actionMenuAlign,
    diagnosisMode,
    isSubRow,
    style,
    runtime,
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
