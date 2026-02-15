/**
 * PatientInputCells - Orchestrator component for patient data input cells
 *
 * This component composes atomic sub-components for each input field.
 * Each sub-component is independently testable and maintainable.
 */

import React from 'react';
import { PatientData } from '@/types';
import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';

// Atomic sub-components
import { NameInput } from './NameInput';
import { RutPassportInput } from './RutPassportInput';
import { AgeInput } from './AgeInput';
import { DiagnosisInput } from './DiagnosisInput';
import { DualSpecialtyCell } from './DualSpecialtyCell';
import { StatusSelect } from './StatusSelect';
import { AdmissionInput } from './AdmissionInput';
import { DevicesCell } from './DevicesCell';
import { CheckboxCell } from './CheckboxCell';
import type { PatientInputChangeHandlers } from './inputCellTypes';
import { usePatientInputCellsModel } from '@/features/census/components/patient-row/usePatientInputCellsModel';

interface PatientInputCellsProps {
  data: PatientData;
  currentDateString: string;
  isSubRow?: boolean;
  isEmpty?: boolean;
  onChange: PatientInputChangeHandlers;
  onDemo: () => void;
  readOnly?: boolean;
  diagnosisMode?: DiagnosisMode;
}

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

  // Common props for all cells
  const commonProps = {
    data,
    isSubRow,
    isEmpty,
    readOnly: isLocked,
  };

  return (
    <>
      {/* Name */}
      <NameInput {...commonProps} onChange={handleDebouncedText} />

      {/* RUT / Passport */}
      <RutPassportInput
        value={data.rut || ''}
        documentType={data.documentType || 'RUT'}
        isSubRow={isSubRow}
        isEmpty={isEmpty}
        hasName={!!data.patientName && !isEmpty}
        patientName={data.patientName || ''}
        currentDateString={currentDateString}
        admissionDate={data.admissionDate}
        onChange={handleDebouncedText('rut')}
        onToggleType={onChange.toggleDocType}
        readOnly={isLocked}
        hasError={hasRutError}
      />

      {/* Age */}
      <AgeInput {...commonProps} onOpenDemographics={onDemo} />

      {/* Diagnosis */}
      <DiagnosisInput
        {...commonProps}
        diagnosisMode={diagnosisMode}
        onChange={handleDebouncedText}
        onMultipleUpdate={onChange.multiple}
        onDeliveryRouteChange={onChange.deliveryRoute}
      />

      {/* Specialty (Primary + Optional Secondary) */}
      <DualSpecialtyCell {...commonProps} onChange={onChange.text} />

      {/* Status */}
      <StatusSelect {...commonProps} onChange={onChange.text} />

      {/* Admission */}
      <AdmissionInput
        {...commonProps}
        onChange={handleDebouncedText}
        onMultipleUpdate={onChange.multiple}
      />

      {/* Devices */}
      <DevicesCell
        {...commonProps}
        currentDateString={currentDateString}
        onDevicesChange={onChange.devices}
        onDeviceDetailsChange={onChange.deviceDetails}
        onDeviceHistoryChange={onChange.deviceHistory}
      />

      {/* Surgical Complication */}
      <CheckboxCell
        {...commonProps}
        field="surgicalComplication"
        onChange={onChange.check}
        title="Comp. Qx"
        colorClass="text-red-600"
      />

      {/* UPC */}
      <CheckboxCell
        {...commonProps}
        field="isUPC"
        onChange={onChange.check}
        title="UPC"
        colorClass="text-purple-600"
        isLastColumn
      />
    </>
  );
};
