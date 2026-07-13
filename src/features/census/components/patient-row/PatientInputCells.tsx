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
  PatientInputStatusSection,
} from '@/features/census/components/patient-row/PatientInputCellSections';
import type { PatientInputCellsProps } from '@/features/census/components/patient-row/patientRowContracts';
import { isSpecialistCensusAccessProfile } from '@/features/census/types/censusAccessProfile';

export const PatientInputCells: React.FC<PatientInputCellsProps> = ({
  data,
  currentDateString,
  isNewAdmission = false,
  isSubRow = false,
  isEmpty = false,
  onChange,
  onDemo,
  readOnly = false,
  clinicalEditingDisabled = false,
  clinicalFieldLocks,
  diagnosisMode = 'free',
  accessProfile = 'default',
}) => {
  const { isLocked, hasRutError, handleDebouncedText } = usePatientInputCellsModel({
    data,
    readOnly,
    textChange: onChange.text,
  });
  const sectionBindings = usePatientInputSectionBindings({
    data,
    currentDateString,
    isNewAdmission,
    isSubRow,
    isEmpty,
    isLocked,
    clinicalEditingDisabled,
    clinicalFieldLocks,
    diagnosisMode,
    hasRutError,
    handleDebouncedText,
    onDemo,
    onChange,
  });
  const specialistAccess = isSpecialistCensusAccessProfile(accessProfile);

  return (
    <>
      {/* Estado clínico primero (columna movida al lugar de "Tipo de cama"). */}
      <PatientInputStatusSection {...sectionBindings.clinical} accessProfile={accessProfile} />

      <PatientInputIdentitySection {...sectionBindings.identity} />

      <PatientInputClinicalSection {...sectionBindings.clinical} accessProfile={accessProfile} />

      <PatientInputFlowSection {...sectionBindings.flow} accessProfile={accessProfile} />

      {!specialistAccess && <PatientInputFlagsSection {...sectionBindings.flags} />}
    </>
  );
};
