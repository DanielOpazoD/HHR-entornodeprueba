import React from 'react';
import { Share2 } from 'lucide-react';
import { getTimeRoundedToStep } from '@/utils/dateUtils';
import { BaseModal } from '@/components/shared/BaseModal';
import { TransferClinicalCribNotice } from '@/features/census/components/movements/transfer/TransferClinicalCribNotice';
import { TransferEvacuationSection } from '@/features/census/components/movements/transfer/TransferEvacuationSection';
import { TransferReceivingSection } from '@/features/census/components/movements/transfer/TransferReceivingSection';
import { MovementDateTimeField } from '@/features/census/components/movements/shared/MovementDateTimeField';
import { MovementFinalStateNotice } from '@/features/census/components/movements/shared/MovementFinalStateNotice';
import { useTransferModalForm } from '@/features/census/components/movements/useTransferModalForm';
import type { TransferModalProps } from '@/features/census/types/censusActionModalContracts';

export type { TransferUpdateField } from '@/features/census/types/censusActionModalContracts';

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  isEditing,
  evacuationMethod,
  evacuationMethodOther,
  receivingCenter,
  receivingCenterOther,
  transferEscort,
  onUpdate,
  onClose,
  onConfirm,
  hasClinicalCrib,
  clinicalCribName,
  initialTime,
  initialMovementDate,
  diagnosis,
  recordDate = '',
}) => {
  const {
    transferDate,
    transferTime,
    movementBounds,
    errors,
    isPredefinedEscort,
    setTransferDate,
    setTransferTime,
    setReceivingCenterOther,
    setEvacuationMethodOther,
    setTransferEscortValue,
    handleEscortChange,
    handleEvacuationChange,
    submit,
  } = useTransferModalForm({
    isOpen,
    recordDate,
    includeMovementDate: isEditing,
    initialTime,
    initialMovementDate,
    evacuationMethod,
    evacuationMethodOther,
    receivingCenter,
    receivingCenterOther,
    transferEscort,
    diagnosis,
    onUpdate,
    onConfirm,
    resolveDefaultTime: getTimeRoundedToStep,
  });

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Editar Traslado' : 'Confirmar Traslado'}
      icon={<Share2 size={16} />}
      size="md"
      headerIconColor="text-blue-600"
      variant="white"
    >
      <div className="space-y-5">
        {!isEditing && (
          <MovementFinalStateNotice tone="blue">
            Se registrará el traslado clínico para esta cama del censo.
          </MovementFinalStateNotice>
        )}

        {!isEditing && hasClinicalCrib && (
          <TransferClinicalCribNotice clinicalCribName={clinicalCribName} />
        )}

        <div className="space-y-4">
          <TransferEvacuationSection
            evacuationMethod={evacuationMethod}
            evacuationMethodOther={evacuationMethodOther}
            transferEscort={transferEscort}
            isPredefinedEscort={isPredefinedEscort}
            evacuationOtherError={errors.otherEvacuation}
            escortError={errors.escort}
            onEvacuationMethodChange={handleEvacuationChange}
            onEvacuationMethodOtherChange={setEvacuationMethodOther}
            onEscortSelectChange={handleEscortChange}
            onEscortValueChange={setTransferEscortValue}
          />

          <TransferReceivingSection
            receivingCenter={receivingCenter}
            receivingCenterOther={receivingCenterOther}
            otherCenterError={errors.otherCenter}
            onReceivingCenterChange={value => onUpdate('receivingCenter', value)}
            onReceivingCenterOtherChange={setReceivingCenterOther}
          />

          <MovementDateTimeField
            label={isEditing ? 'Fecha y Hora de Traslado' : 'Hora de Traslado'}
            showDateInput={isEditing}
            dateValue={transferDate}
            timeValue={transferTime}
            minDate={movementBounds.minDate}
            maxDate={movementBounds.maxDate}
            nextDay={movementBounds.nextDay}
            nextDayMaxTime={movementBounds.nextDayMaxTime}
            timeError={errors.time}
            dateTimeError={errors.dateTime}
            tone="blue"
            onDateChange={setTransferDate}
            onTimeChange={setTransferTime}
          />

          {isEditing && (
            <label className="block text-xs font-medium text-slate-600">
              Diagnóstico de egreso
              <textarea
                className="mt-1 min-h-20 w-full rounded border border-slate-200 bg-white p-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                value={diagnosis || ''}
                onChange={event => onUpdate('diagnosis', event.target.value)}
              />
            </label>
          )}
        </div>

        <div className="pt-6 flex justify-end items-center gap-4">
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 text-sm font-semibold transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-md shadow-blue-600/10 hover:bg-blue-700 transition-all transform active:scale-95"
          >
            {isEditing ? 'Guardar Cambios' : 'Confirmar Traslado'}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
