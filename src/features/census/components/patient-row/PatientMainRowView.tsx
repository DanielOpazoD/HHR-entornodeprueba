import React from 'react';
import { PatientBedConfig } from './PatientBedConfig';
import { PatientInputCells } from './PatientInputCells';
import { PatientMainRowActionCell } from './PatientMainRowActionCell';
// PatientMainRowBedTypeCell conservado para reactivación futura de la columna "Tipo de cama".
import { PatientMainRowBlockedCell } from './PatientMainRowBlockedCell';
import type { PatientMainRowViewProps } from './patientRowContracts';
import { usePatientMainRowSectionsModel } from './usePatientMainRowSectionsModel';

export const PatientMainRowView: React.FC<PatientMainRowViewProps> = ({
  bed,
  bedType,
  data,
  currentDateString,
  style,
  readOnly,
  clinicalEditingDisabled,
  clinicalFieldLocks,
  actionMenuAlign,
  diagnosisMode,
  isBlocked,
  isEmpty,
  hasCompanion,
  hasClinicalCrib,
  isCunaMode,
  indicators,
  mainRowViewState,
  accessProfile = 'default',
  onAction,
  onOpenDemographics,
  onOpenClinicalDocuments,
  onOpenExamRequest,
  onOpenImagingRequest,
  onOpenHistory,
  onToggleMode,
  onToggleCompanion,
  onToggleClinicalCrib,
  onToggleBedType,
  onUpdateClinicalCrib,
  onChange,
  draggable,
  isDragging,
  isPendingClear = false,
  onDragStart,
  onDragEnd,
  clinicalDocumentCount,
}) => {
  const sections = usePatientMainRowSectionsModel({
    bed,
    bedType,
    data,
    currentDateString,
    style,
    readOnly,
    clinicalEditingDisabled,
    clinicalFieldLocks,
    actionMenuAlign,
    diagnosisMode,
    isBlocked,
    isEmpty,
    hasCompanion,
    hasClinicalCrib,
    isCunaMode,
    indicators,
    mainRowViewState,
    accessProfile,
    onAction,
    onOpenDemographics,
    onOpenClinicalDocuments,
    onOpenExamRequest,
    onOpenImagingRequest,
    onOpenHistory,
    onToggleMode,
    onToggleCompanion,
    onToggleClinicalCrib,
    onToggleBedType,
    onUpdateClinicalCrib,
    onChange,
    clinicalDocumentCount,
  });

  return (
    <tr
      className={`${mainRowViewState.rowClassName} group/patient-row ${isDragging ? 'opacity-40' : ''} ${isPendingClear ? 'bg-amber-50/70 opacity-75' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={style}
      data-testid="patient-row"
      data-bed-id={bed.id}
      data-clear-pending={isPendingClear || undefined}
      aria-busy={isPendingClear}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <PatientMainRowActionCell {...sections.action} isPendingClear={isPendingClear} />

      <PatientBedConfig {...sections.bedConfig} />

      {/* Columna "Tipo de cama" oculta (rediseño 2026): el estado clínico ocupa ahora este lugar,
          renderizado como primera celda de PatientInputCells. PatientMainRowBedTypeCell se conserva
          para reactivación futura (quitar 'type' de HIDDEN_CENSUS_COLUMNS y reponer la celda aquí). */}

      {mainRowViewState.showBlockedContent ? (
        <PatientMainRowBlockedCell {...sections.blocked} />
      ) : (
        <PatientInputCells {...sections.inputCells} />
      )}
    </tr>
  );
};
