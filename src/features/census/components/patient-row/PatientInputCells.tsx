/**
 * PatientInputCells - Orchestrator component for patient data input cells
 *
 * This component composes atomic sub-components for each input field.
 * Each sub-component is independently testable and maintainable.
 */

import React from 'react';
import { usePatientInputCellsModel } from '@/features/census/components/patient-row/usePatientInputCellsModel';
import { usePatientInputSectionBindings } from '@/features/census/components/patient-row/usePatientInputSectionBindings';
import {
  PatientInputClinicalSection,
  PatientInputFlagsSection,
  PatientInputFlowSection,
  PatientInputIdentitySection,
} from '@/features/census/components/patient-row/PatientInputCellSections';
import type { PatientInputCellsProps } from '@/features/census/components/patient-row/patientRowViewContracts';

export const PatientInputCells: React.FC<PatientInputCellsProps> = ({
  data,
  currentDateString,
  isSubRow = false,
  isEmpty = false,
  onChange,
  onDemo,
  readOnly = false,
  diagnosisMode = 'free',
}) => {
  const { isLocked, hasRutError, handleDebouncedText } = usePatientInputCellsModel({
    data,
    readOnly,
    textChange: onChange.text,
  });
  const sectionBindings = usePatientInputSectionBindings({
    data,
    currentDateString,
    isSubRow,
    isEmpty,
    isLocked,
    diagnosisMode,
    hasRutError,
    handleDebouncedText,
    onDemo,
    onChange,
  });

  return (
    <>
      <PatientInputIdentitySection {...sectionBindings.identity} />

      <PatientInputClinicalSection {...sectionBindings.clinical} />

      <PatientInputFlowSection {...sectionBindings.flow} />

      <PatientInputFlagsSection {...sectionBindings.flags} />
    </>
  );
};
