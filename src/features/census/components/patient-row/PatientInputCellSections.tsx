import React from 'react';
import { PatientIdentityCell } from './PatientIdentityCell';
import { DiagnosisInput } from './DiagnosisInput';
import { SpecialtyCell } from './SpecialtyCell';
import { StatusSelect } from './StatusSelect';
import { VitalsCell } from './VitalsCell';
import { DevicesCell } from './DevicesCell';
import { ScoresCell } from './ScoresCell';
import { UpcChecklistPopover } from './UpcChecklistPopover';
import { ClinicalInitialBlockCells } from './ClinicalInitialBlockCells';
import type {
  PatientInputClinicalSectionBindings,
  PatientInputFlagsSectionBindings,
  PatientInputFlowSectionBindings,
  PatientInputIdentitySectionBindings,
} from '@/features/census/components/patient-row/patientInputSectionContracts';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { isSpecialistCensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import { isUpcEligibleBedId } from '@/shared/census/upcBedPolicy';
import { useAuth } from '@/context/AuthContext';
import type { UpcChecklistRecord } from '@/features/census/contracts/censusUpcContracts';
import { logger } from '@/services/utils/loggerService';
import {
  acknowledgeDailyRecordClinicalFieldPause,
  DAILY_RECORD_FIELD_PAUSE_MESSAGE,
  getDailyRecordClinicalFieldPause,
  type DailyRecordClinicalFieldGroup,
} from '@/hooks/controllers/dailyRecordClinicalFieldAcknowledgementController';

const patientInputFlagsLogger = logger.child('PatientInputFlagsSection');

const isRemoteLocked = (locked?: boolean): boolean => Boolean(locked);

const buildClinicalPause = (
  date: string,
  bedId: string,
  fieldGroup: DailyRecordClinicalFieldGroup,
  paused: boolean
) => {
  const pause = paused ? getDailyRecordClinicalFieldPause(date, bedId, fieldGroup) : null;
  return {
    isPaused: Boolean(pause && !pause.acknowledged),
    message: DAILY_RECORD_FIELD_PAUSE_MESSAGE,
    token: pause ? `${date}:${bedId}:${fieldGroup}:${pause.createdAt}` : undefined,
    onAcknowledge: () => {
      acknowledgeDailyRecordClinicalFieldPause(date, bedId, fieldGroup);
    },
  };
};

/**
 * Rediseño censo 2026: la identidad se renderiza en una sola celda "Paciente"
 * (nombre + edad + RUT). Los componentes NameInput / RutPassportInput / AgeInput
 * se conservan intactos para reactivación futura de las columnas separadas.
 */
export const PatientInputIdentitySection: React.FC<PatientInputIdentitySectionBindings> = ({
  shared,
  hasRutError,
  handleDebouncedText,
  onDemo,
}) => (
  <PatientIdentityCell
    data={shared.data}
    isSubRow={shared.isSubRow}
    isEmpty={shared.isEmpty}
    readOnly={shared.isLocked}
    hasRutError={hasRutError}
    onNameChange={handleDebouncedText}
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
  const statusLocked = isRemoteLocked(shared.clinicalFieldLocks?.status);
  return (
    <StatusSelect
      data={shared.data}
      isSubRow={shared.isSubRow}
      isEmpty={shared.isEmpty}
      readOnly={baseClinicalReadOnly}
      clinicalPause={buildClinicalPause(
        shared.currentDateString,
        shared.data.bedId,
        'status',
        !baseClinicalReadOnly && statusLocked
      )}
      onChange={onChange.text}
    />
  );
};

export const PatientInputClinicalSection: React.FC<
  PatientInputClinicalSectionBindings & { accessProfile?: CensusAccessProfile }
> = ({ shared, diagnosisMode, handleDebouncedText, onChange, accessProfile = 'default' }) => {
  const fieldLocks = shared.clinicalFieldLocks;
  const diagnosisLocked = isRemoteLocked(fieldLocks?.diagnosis);
  const specialtyLocked = isRemoteLocked(fieldLocks?.specialty);
  const baseClinicalReadOnly = shared.isLocked || shared.clinicalEditingDisabled;
  const usesClinicalInitialBlockPanel =
    !shared.isSubRow && !shared.isEmpty && !!shared.data.patientName;

  if (usesClinicalInitialBlockPanel) {
    return (
      <ClinicalInitialBlockCells
        data={shared.data}
        readOnly={baseClinicalReadOnly}
        accessProfile={accessProfile}
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
        clinicalPause={buildClinicalPause(
          shared.currentDateString,
          shared.data.bedId,
          'diagnosis',
          !baseClinicalReadOnly && diagnosisLocked
        )}
        diagnosisMode={diagnosisMode}
        onChange={handleDebouncedText}
        onMultipleUpdate={onChange.multiple}
        onDeliveryRouteChange={onChange.deliveryRoute}
      />
      <SpecialtyCell
        data={shared.data}
        isSubRow={shared.isSubRow}
        isEmpty={shared.isEmpty}
        readOnly={baseClinicalReadOnly}
        clinicalPause={buildClinicalPause(
          shared.currentDateString,
          shared.data.bedId,
          'specialty',
          !baseClinicalReadOnly && specialtyLocked
        )}
        onChange={onChange.text}
        onMultipleUpdate={onChange.multiple}
      />
      {/* El estado clínico ya NO va aquí: se renderiza en su propia columna (PatientInputStatusSection),
          movido a la posición de "Tipo de cama". */}
    </>
  );
};

export const PatientInputFlowSection: React.FC<
  PatientInputFlowSectionBindings & { accessProfile?: CensusAccessProfile }
> = ({ shared, onChange, accessProfile = 'default' }) => (
  <>
    {/* Rediseño censo 2026 "centro de vigilancia": la columna de Ingreso se reutiliza para los
        SIGNOS VITALES (PA·FC·SAT·T°). La fecha de ingreso se muestra junto al RUT en la celda
        "Paciente" (PatientIdentityCell). AdmissionInput se conserva para reactivación futura. */}
    <VitalsCell data={shared.data} isSubRow={shared.isSubRow} isEmpty={shared.isEmpty} />
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

export const PatientInputFlagsSection: React.FC<PatientInputFlagsSectionBindings> = ({
  shared,
  onChange,
}) => {
  const upcEligible = isUpcEligibleBedId(shared.data.bedId);
  const { currentUser } = useAuth();
  const fieldLocks = shared.clinicalFieldLocks;
  const upcLocked = isRemoteLocked(fieldLocks?.upc);
  const baseClinicalReadOnly = shared.isLocked || shared.clinicalEditingDisabled;
  const upcActor = currentUser
    ? { uid: currentUser.uid, displayName: currentUser.displayName || currentUser.email || '' }
    : null;

  const handleUpcSave = (record: UpcChecklistRecord) => {
    try {
      onChange.multiple?.({
        upcChecklist: record,
        isUPC: record.classification !== null,
      });
    } catch (err) {
      patientInputFlagsLogger.error('Failed to save UPC checklist', err);
    }
  };

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
          clinicalPause={buildClinicalPause(
            shared.currentDateString,
            shared.data.bedId,
            'surgicalComplication',
            !baseClinicalReadOnly && isRemoteLocked(fieldLocks?.surgicalComplication)
          )}
          field="surgicalComplication"
          onChange={onChange.check}
          title="Comp. Qx"
          colorClass="text-red-600"
        />

        (reimportar CheckboxCell desde './CheckboxCell' y reponer la columna cqx en
        censusTableHeaderController / HIDDEN_CENSUS_COLUMNS / tableConfigService).
      */}
      <UpcChecklistPopover
        data={shared.data}
        isSubRow={shared.isSubRow}
        isEmpty={shared.isEmpty}
        readOnly={baseClinicalReadOnly}
        clinicalPause={buildClinicalPause(
          shared.currentDateString,
          shared.data.bedId,
          'upc',
          !baseClinicalReadOnly && upcLocked
        )}
        checklist={shared.data.upcChecklist}
        onSave={handleUpcSave}
        eligible={upcEligible}
        actor={upcActor}
      />
    </>
  );
};
