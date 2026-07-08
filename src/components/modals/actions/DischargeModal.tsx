import React from 'react';
import { LogOut } from 'lucide-react';
import { getTimeRoundedToStep } from '@/utils/dateUtils';
import { BaseModal } from '@/components/shared/BaseModal';
import { DischargeType } from '@/constants/clinicalMovementConstants';
import { ClinicalCribStatusSection } from '@/components/modals/actions/discharge/ClinicalCribStatusSection';
import { DischargeStatusRadioGroup } from '@/components/modals/actions/discharge/DischargeStatusRadioGroup';
import { DischargeTargetSelector } from '@/components/modals/actions/discharge/DischargeTargetSelector';
import { DischargeTimeField } from '@/components/modals/actions/discharge/DischargeTimeField';
import { DischargeTypeSelector } from '@/components/modals/actions/discharge/DischargeTypeSelector';
import { MovementFinalStateNotice } from '@/components/modals/actions/shared/MovementFinalStateNotice';
import type { DischargeTarget } from '@/types/movements';
import { shouldShowBabyStatus, shouldShowMotherStatus } from '@/application/census/public';
import { useDischargeModalForm } from '@/hooks/useDischargeModalForm';
import type { DischargeModalProps } from '@/hooks/types/censusActionModalContracts';

export type DischargeTypeUnion = DischargeType;

export const DischargeModal: React.FC<DischargeModalProps> = ({
  isOpen,
  isEditing,
  status,
  onStatusChange,
  onClose,
  onConfirm,
  hasClinicalCrib,
  clinicalCribName,
  clinicalCribStatus,
  onClinicalCribStatusChange,
  dischargeTarget = 'both',
  onDischargeTargetChange,
  initialType,
  initialOtherDetails,
  initialTime,
  initialMovementDate,
  diagnosis: initialDiagnosis,
  recordDate = '',
}) => {
  const {
    dischargeType,
    otherDetails,
    dischargeDate,
    dischargeTime,
    movementBounds,
    localTarget,
    diagnosis,
    errors,
    setDischargeType,
    setOtherDetails,
    setDischargeDate,
    setDischargeTime,
    setLocalTarget,
    setDiagnosis,
    submit,
  } = useDischargeModalForm({
    isOpen,
    status,
    recordDate,
    includeMovementDate: isEditing,
    initialMovementDate,
    initialType,
    initialOtherDetails,
    initialTime,
    dischargeTarget,
    initialDiagnosis,
    hasClinicalCrib,
    resolveDefaultTime: getTimeRoundedToStep,
    onConfirm,
  });

  const handleTargetChange = (target: DischargeTarget) => {
    setLocalTarget(target);
    onDischargeTargetChange?.(target);
  };

  const showMotherStatus = shouldShowMotherStatus(localTarget);
  const showBabyStatus = shouldShowBabyStatus(localTarget, hasClinicalCrib);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Editar Alta Médica' : 'Confirmar Alta Médica'}
      icon={<LogOut size={16} />}
      size="md"
      headerIconColor="text-emerald-600"
      variant="white"
    >
      <div className="space-y-5">
        {!isEditing && (
          <MovementFinalStateNotice tone="emerald">
            Se registrará el egreso en el censo y se actualizará la disponibilidad asociada.
          </MovementFinalStateNotice>
        )}

        {!isEditing && hasClinicalCrib && onDischargeTargetChange && (
          <DischargeTargetSelector target={localTarget} onChange={handleTargetChange} />
        )}

        {showMotherStatus && (
          <div className="space-y-4">
            <DischargeStatusRadioGroup
              inputName="status"
              label={`Estado ${localTarget === 'both' ? 'Madre / Paciente' : 'Paciente'}`}
              status={status}
              onChange={onStatusChange}
            />

            {status === 'Vivo' && (
              <DischargeTypeSelector
                selectedType={dischargeType}
                otherDetails={otherDetails}
                otherError={errors.other}
                onTypeChange={setDischargeType}
                onOtherDetailsChange={setOtherDetails}
              />
            )}

            <DischargeTimeField
              showDateInput={isEditing}
              dateValue={dischargeDate}
              value={dischargeTime}
              minDate={movementBounds.minDate}
              maxDate={movementBounds.maxDate}
              nextDay={movementBounds.nextDay}
              nextDayMaxTime={movementBounds.nextDayMaxTime}
              timeError={errors.time}
              dateTimeError={errors.dateTime}
              onDateChange={setDischargeDate}
              onChange={setDischargeTime}
            />

            {isEditing && (
              <label className="block text-xs font-medium text-slate-600">
                Diagnóstico de egreso
                <textarea
                  className="mt-1 min-h-20 w-full rounded border border-slate-200 bg-white p-2 text-sm text-slate-700 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                  value={diagnosis}
                  onChange={event => setDiagnosis(event.target.value)}
                />
              </label>
            )}
          </div>
        )}

        {localTarget === 'baby' &&
          !showMotherStatus &&
          hasClinicalCrib &&
          onClinicalCribStatusChange && (
            <div className="space-y-4">
              <ClinicalCribStatusSection
                clinicalCribName={clinicalCribName}
                clinicalCribStatus={clinicalCribStatus}
                onClinicalCribStatusChange={onClinicalCribStatusChange}
              />
              <DischargeTimeField
                showDateInput={isEditing}
                dateValue={dischargeDate}
                value={dischargeTime}
                minDate={movementBounds.minDate}
                maxDate={movementBounds.maxDate}
                nextDay={movementBounds.nextDay}
                nextDayMaxTime={movementBounds.nextDayMaxTime}
                timeError={errors.time}
                dateTimeError={errors.dateTime}
                onDateChange={setDischargeDate}
                onChange={setDischargeTime}
              />
            </div>
          )}

        {!isEditing && showBabyStatus && localTarget === 'both' && onClinicalCribStatusChange && (
          <ClinicalCribStatusSection
            withTopBorder={true}
            clinicalCribName={clinicalCribName || 'RN'}
            clinicalCribStatus={clinicalCribStatus}
            onClinicalCribStatusChange={onClinicalCribStatusChange}
          />
        )}

        <div className="pt-6 flex justify-end items-center gap-4">
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 text-sm font-semibold transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            className="px-6 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-bold shadow-md shadow-emerald-600/10 hover:bg-emerald-700 transition-all transform active:scale-95"
          >
            {isEditing ? 'Guardar Cambios' : 'Confirmar Alta'}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
