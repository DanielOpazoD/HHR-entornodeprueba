import React from 'react';
import { PatientIdentityCell } from './PatientIdentityCell';
import { DiagnosisInput } from './DiagnosisInput';
import { StatusSelect } from './StatusSelect';
import { VitalsCell } from './VitalsCell';
import { DevicesCell } from './DevicesCell';
import { ScoresCell } from './ScoresCell';
import { UpcChecklistCell } from './UpcChecklistCell';
import { ClinicalAlertsViewCell } from './ClinicalAlertsViewCell';
import { useCensusViewPreferences } from '@/features/census/hooks/useCensusViewPreferences';
import { ClinicalInitialBlockCells } from './ClinicalInitialBlockCells';
import { useClinicalDerivedEpisodeGeneration } from './clinicalDerivedDayContext';
import type {
  PatientInputClinicalSectionBindings,
  PatientInputFlagsSectionBindings,
  PatientInputFlowSectionBindings,
  PatientInputIdentitySectionBindings,
} from '@/features/census/components/patient-row/patientInputSectionContracts';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { isSpecialistCensusAccessProfile } from '@/features/census/types/censusAccessProfile';
/**
 * Rediseño censo 2026: la identidad se renderiza en una sola celda "Paciente"
 * (nombre + edad + RUT). Los componentes NameInput / RutPassportInput / AgeInput
 * se conservan intactos para reactivación futura de las columnas separadas.
 */
export const PatientInputIdentitySection: React.FC<
  PatientInputIdentitySectionBindings & { parentBedId?: string }
> = ({ shared, parentBedId, hasRutError, handleDebouncedText, onDemo, onChange }) => (
  <PatientIdentityCell
    data={shared.data}
    parentBedId={parentBedId}
    isSubRow={shared.isSubRow}
    isEmpty={shared.isEmpty}
    readOnly={shared.isLocked}
    physicianReadOnly={shared.isLocked || shared.clinicalEditingDisabled}
    currentDateString={shared.currentDateString}
    hasRutError={hasRutError}
    onNameChange={handleDebouncedText}
    onMultipleUpdate={onChange.multiple}
    onOpenDemographics={onDemo}
  />
);

/**
 * Estado clínico — su propia columna (rediseño 2026), movida a la posición donde estaba "Tipo de
 * cama" (justo tras la cama). Es un círculo de color (verde/amarillo/rojo) con selector propio,
 * desacoplado del editor de Diagnóstico/Especialidad. Oculto para el perfil especialista.
 */
export const PatientInputStatusSection: React.FC<
  PatientInputClinicalSectionBindings & { accessProfile?: CensusAccessProfile }
> = ({ shared, onChange, accessProfile = 'default' }) => {
  if (isSpecialistCensusAccessProfile(accessProfile)) return null;
  const baseClinicalReadOnly = shared.isLocked || shared.clinicalEditingDisabled;
  return (
    <StatusSelect
      data={shared.data}
      isSubRow={shared.isSubRow}
      isEmpty={shared.isEmpty}
      readOnly={baseClinicalReadOnly}
      onChange={onChange.text}
    />
  );
};

export const PatientInputClinicalSection: React.FC<
  PatientInputClinicalSectionBindings & { accessProfile?: CensusAccessProfile }
> = ({ shared, diagnosisMode, handleDebouncedText, onChange }) => {
  const baseClinicalReadOnly = shared.isLocked || shared.clinicalEditingDisabled;
  const usesClinicalInitialBlockPanel =
    !shared.isSubRow && !shared.isEmpty && !!shared.data.patientName;

  if (usesClinicalInitialBlockPanel) {
    return (
      <ClinicalInitialBlockCells
        currentDateString={shared.currentDateString}
        data={shared.data}
        readOnly={baseClinicalReadOnly}
        onChange={handleDebouncedText}
        onMultipleUpdate={onChange.multiple}
        onDeliveryRouteChange={onChange.deliveryRoute}
      />
    );
  }

  return (
    <>
      <DiagnosisInput
        data={shared.data}
        isSubRow={shared.isSubRow}
        isEmpty={shared.isEmpty}
        readOnly={baseClinicalReadOnly}
        diagnosisMode={diagnosisMode}
        onChange={handleDebouncedText}
        onMultipleUpdate={onChange.multiple}
        onDeliveryRouteChange={onChange.deliveryRoute}
      />
      {/* Especialidad y Estado clínico ya NO van aquí: la especialidad es texto en la celda Paciente
          (junto a FI) y el estado es su propia columna (círculo, PatientInputStatusSection). */}
    </>
  );
};

export const PatientInputFlowSection: React.FC<
  PatientInputFlowSectionBindings & { accessProfile?: CensusAccessProfile }
> = ({ shared, onChange, accessProfile = 'default' }) => {
  const layoutGeneration = useClinicalDerivedEpisodeGeneration(shared.data.clinicalEpisodeId);
  const { alertsView } = useCensusViewPreferences();
  if (alertsView && !isSpecialistCensusAccessProfile(accessProfile)) {
    return (
      <ClinicalAlertsViewCell
        data={shared.data}
        isSubRow={shared.isSubRow}
        isEmpty={shared.isEmpty}
      />
    );
  }
  return (
    <>
      {/* Rediseño censo 2026 "centro de vigilancia": la columna de Ingreso se reutiliza para los
          SIGNOS VITALES (PA·FC·SAT·T°). La fecha de ingreso se muestra junto al RUT en la celda
          "Paciente" (PatientIdentityCell). AdmissionInput se conserva para reactivación futura. */}
      <VitalsCell
        data={shared.data}
        isSubRow={shared.isSubRow}
        isEmpty={shared.isEmpty}
        date={shared.currentDateString}
        clinicalEpisodeId={shared.data.clinicalEpisodeId}
        layoutGeneration={layoutGeneration}
      />
      {!isSpecialistCensusAccessProfile(accessProfile) && (
        <>
          <DevicesCell
            data={shared.data}
            isSubRow={shared.isSubRow}
            isEmpty={shared.isEmpty}
            readOnly={shared.isLocked}
            currentDateString={shared.currentDateString}
            onDevicesChange={onChange.devices}
            onDeviceDetailsChange={onChange.deviceDetails}
            onDeviceHistoryChange={onChange.deviceHistory}
            onDeviceBundleChange={onChange.multiple}
          />
          <ScoresCell
            data={shared.data}
            isSubRow={shared.isSubRow}
            isEmpty={shared.isEmpty}
            readOnly={shared.isLocked}
            currentDateString={shared.currentDateString}
          />
        </>
      )}
    </>
  );
};

export const PatientInputFlagsSection: React.FC<PatientInputFlagsSectionBindings> = ({
  shared,
}) => {
  const { alertsView } = useCensusViewPreferences();
  const baseClinicalReadOnly = shared.isLocked || shared.clinicalEditingDisabled;
  // The «Alertas» view already spans the UPC column.
  if (alertsView) return null;

  return (
    <>
      {/*
        Columna C.QX oculta (rediseño censo 2026). El campo surgicalComplication y el
        componente CheckboxCell se conservan; para reactivar, restaurar el bloque:

        <CheckboxCell
          data={shared.data}
          isSubRow={shared.isSubRow}
          isEmpty={shared.isEmpty}
          readOnly={baseClinicalReadOnly}
          field="surgicalComplication"
          onChange={onChange.check}
          title="Comp. Qx"
          colorClass="text-red-600"
        />

        (reimportar CheckboxCell desde './CheckboxCell' y reponer la columna cqx en
        censusTableHeaderController / HIDDEN_CENSUS_COLUMNS / tableConfigService).
      */}
      <UpcChecklistCell
        key={`${shared.currentDateString}:${shared.data.bedId}:${shared.data.clinicalEpisodeId || shared.data.rut}:${shared.data.admissionDate}`}
        data={shared.data}
        currentDateString={shared.currentDateString}
        isSubRow={shared.isSubRow}
        isEmpty={shared.isEmpty}
        readOnly={baseClinicalReadOnly}
        checklist={shared.data.upcChecklist}
      />
    </>
  );
};
