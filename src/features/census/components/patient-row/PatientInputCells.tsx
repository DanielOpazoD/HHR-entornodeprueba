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
import { PatientClinicalAccess } from '@/features/census/components/patient-row/PatientClinicalAccess';

export const PatientInputCells: React.FC<PatientInputCellsProps> = ({
  data,
  parentBedId,
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
  clinicalAccess,
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

      <PatientInputIdentitySection {...sectionBindings.identity} parentBedId={parentBedId} />

      <td className="census-access-cell border-r border-slate-200 px-0.5 py-1 align-middle">
        {clinicalAccess && <PatientClinicalAccess {...clinicalAccess} />}
      </td>

      <PatientInputClinicalSection {...sectionBindings.clinical} accessProfile={accessProfile} />

      <PatientInputFlowSection {...sectionBindings.flow} accessProfile={accessProfile} />

      {!specialistAccess && <PatientInputFlagsSection {...sectionBindings.flags} />}
    </>
  );
};
