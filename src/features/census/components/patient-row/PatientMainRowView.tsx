import React from 'react';
import { PatientBedConfig } from './PatientBedConfig';
import { PatientInputCells } from './PatientInputCells';
import { PatientMainRowActionCell } from './PatientMainRowActionCell';
// PatientMainRowBedTypeCell conservado para reactivación futura de la columna "Tipo de cama".
import { PatientMainRowBlockedCell } from './PatientMainRowBlockedCell';
import type { PatientMainRowViewProps } from './patientRowContracts';
import { usePatientMainRowSectionsModel } from './usePatientMainRowSectionsModel';
import {
  buildRowAcuity,
  type RowAcuityLevel,
} from '@/features/census/controllers/rowAcuityController';

/** Left "acuity rail" — an inset box-shadow (no layout shift, never fights the row's own hover
 * shadow since it lives on the first cell). Inline style so the per-level color is JIT-independent.
 * amber = watch, red = alert; occupied unblocked rows only. */
const RAIL_STYLE: Record<RowAcuityLevel, React.CSSProperties | undefined> = {
  none: undefined,
  watch: { boxShadow: 'inset 3px 0 0 0 #f59e0b' },
  alert: { boxShadow: 'inset 3px 0 0 0 #ef4444' },
};

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

  // Occupied, unblocked rows get a left rail summarizing their worst clinical state (critical vital
  // or overdue scale → red; warn vital, scale due, or isolation → amber). Empty/blocked rows: none.
  const railStyle =
    isEmpty || isBlocked ? undefined : RAIL_STYLE[buildRowAcuity(data, currentDateString).level];

  return (
    <tr
      className={`${mainRowViewState.rowClassName} group/patient-row ${isDragging ? 'opacity-40' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={style}
      data-testid="patient-row"
      data-bed-id={bed.id}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <PatientMainRowActionCell {...sections.action} railStyle={railStyle} />

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
