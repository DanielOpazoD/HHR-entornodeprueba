import React from 'react';
import { LogOut } from 'lucide-react';
import { getTimeRoundedToStep } from '@/utils';
import { BaseModal } from '@/components/shared/BaseModal';
import { DischargeStatus, DischargeType } from '@/constants';
import {
  ClinicalCribStatusSection,
  DischargeStatusRadioGroup,
  DischargeTargetSelector,
  DischargeTimeField,
  DischargeTypeSelector,
} from '@/components/modals/actions/discharge';
import type { DischargeTarget } from '@/features/census/types/censusActionTypes';
import {
  shouldShowBabyStatus,
  shouldShowMotherStatus,
} from '@/features/census/controllers/dischargeModalController';
import { useDischargeModalForm } from '@/features/census/hooks/useDischargeModalForm';

export type DischargeTypeUnion = DischargeType;

export interface DischargeModalProps {
  isOpen: boolean;
  isEditing: boolean;
  status: DischargeStatus;
  recordDate?: string;

  hasClinicalCrib?: boolean;
  clinicalCribName?: string;
  clinicalCribStatus?: DischargeStatus;
  onClinicalCribStatusChange?: (s: DischargeStatus) => void;

  dischargeTarget?: DischargeTarget;
  onDischargeTargetChange?: (target: DischargeTarget) => void;

  initialType?: string;
  initialOtherDetails?: string;
  initialTime?: string;
  initialMovementDate?: string;

  onStatusChange: (s: DischargeStatus) => void;
  onClose: () => void;
  onConfirm: (data: {
    status: DischargeStatus;
    type?: string;
    typeOther?: string;
    time: string;
    movementDate?: string;
    dischargeTarget?: DischargeTarget;
  }) => void;
}

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
  recordDate = '',
}) => {
  const {
    dischargeType,
    otherDetails,
    dischargeDate,
    dischargeTime,
    movementBounds,
    localTarget,
    errors,
    setDischargeType,
    setOtherDetails,
    setDischargeDate,
    setDischargeTime,
    setLocalTarget,
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
