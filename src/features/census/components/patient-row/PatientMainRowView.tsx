import React from 'react';
import { PatientBedConfig } from './PatientBedConfig';
import { PatientInputCells } from './PatientInputCells';
import { PatientMainRowActionCell } from '@/features/census/components/patient-row/PatientMainRowActionCell';
import { PatientMainRowBedTypeCell } from '@/features/census/components/patient-row/PatientMainRowBedTypeCell';
import { PatientMainRowBlockedCell } from '@/features/census/components/patient-row/PatientMainRowBlockedCell';
import type { PatientMainRowViewProps } from '@/features/census/components/patient-row/patientRowViewContracts';

export const PatientMainRowView: React.FC<PatientMainRowViewProps> = ({
  bed,
  bedType,
  data,
  currentDateString,
  style,
  readOnly,
  actionMenuAlign,
  diagnosisMode,
  isBlocked,
  isEmpty,
  hasCompanion,
  hasClinicalCrib,
  isCunaMode,
  mainRowViewState,
  onAction,
  onOpenDemographics,
  onOpenExamRequest,
  onOpenHistory,
  onToggleMode,
  onToggleCompanion,
  onToggleClinicalCrib,
  onToggleBedType,
  onUpdateClinicalCrib,
  onChange,
}) => {
  return (
    <tr
      className={mainRowViewState.rowClassName}
      style={style}
      data-testid="patient-row"
      data-bed-id={bed.id}
    >
      <PatientMainRowActionCell
        isBlocked={isBlocked}
        readOnly={readOnly}
        align={actionMenuAlign}
        onAction={onAction}
        onViewDemographics={onOpenDemographics}
        onViewExamRequest={
          mainRowViewState.rowActionsAvailability.canOpenExamRequest ? onOpenExamRequest : undefined
        }
        onViewHistory={
          mainRowViewState.rowActionsAvailability.canOpenHistory ? onOpenHistory : undefined
        }
      />

      <PatientBedConfig
        bed={bed}
        data={data}
        currentDateString={currentDateString}
        isBlocked={isBlocked}
        hasCompanion={hasCompanion}
        hasClinicalCrib={hasClinicalCrib}
        isCunaMode={isCunaMode}
        onToggleMode={onToggleMode}
        onToggleCompanion={onToggleCompanion}
        onToggleClinicalCrib={onToggleClinicalCrib}
        onTextChange={onChange.text}
        onUpdateClinicalCrib={onUpdateClinicalCrib}
        readOnly={readOnly}
        align={actionMenuAlign}
      />

      <PatientMainRowBedTypeCell
        bedType={bedType}
        canToggleBedType={mainRowViewState.canToggleBedType}
        onToggleBedType={onToggleBedType}
      />

      {mainRowViewState.showBlockedContent ? (
        <PatientMainRowBlockedCell blockedReason={data.blockedReason} />
      ) : (
        <PatientInputCells
          data={data}
          currentDateString={currentDateString}
          isEmpty={isEmpty}
          onChange={onChange}
          onDemo={onOpenDemographics}
          readOnly={readOnly}
          diagnosisMode={diagnosisMode}
        />
      )}
    </tr>
  );
};
