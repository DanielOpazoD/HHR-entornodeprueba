import React, { useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import { getTimeRoundedToStep } from '@/utils/dateUtils';
import { BaseModal } from '@/components/shared/BaseModal';
import { RECEIVING_CENTER_OTHER, isReceivingCenter } from '@/constants/clinicalMovementConstants';
import { TransferClinicalCribNotice } from '@/components/modals/actions/transfer/TransferClinicalCribNotice';
import { TransferEvacuationSection } from '@/components/modals/actions/transfer/TransferEvacuationSection';
import { TransferReceivingSection } from '@/components/modals/actions/transfer/TransferReceivingSection';
import { TransferTimeField } from '@/components/modals/actions/transfer/TransferTimeField';
import { MovementFinalStateNotice } from '@/components/modals/actions/shared/MovementFinalStateNotice';
import { useTransferModalForm } from '@/hooks/useTransferModalForm';
import type { TransferModalProps } from '@/hooks/types/censusActionModalContracts';
import { getLatestOpenTransferRequestByBedId } from '@/services/transfers/transferService';
import { createScopedLogger } from '@/services/utils/loggerScope';

export type { TransferUpdateField } from '@/hooks/types/censusActionModalContracts';

const transferModalLogger = createScopedLogger('TransferModal');

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  bedId,
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
  recordDate = '',
}) => {
  const [linkedDestinationHospital, setLinkedDestinationHospital] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const syncDestinationFromTransferManagement = async () => {
      if (!isOpen || isEditing || !bedId) {
        if (active) {
          setLinkedDestinationHospital(null);
        }
        return;
      }

      try {
        const linkedTransfer = await getLatestOpenTransferRequestByBedId(bedId);
        if (!active) {
          return;
        }
        if (!linkedTransfer?.destinationHospital) {
          setLinkedDestinationHospital(null);
          return;
        }

        const destinationHospital = linkedTransfer.destinationHospital.trim();
        if (!destinationHospital) {
          setLinkedDestinationHospital(null);
          return;
        }

        setLinkedDestinationHospital(destinationHospital);
        if (isReceivingCenter(destinationHospital)) {
          onUpdate('receivingCenter', destinationHospital);
          onUpdate('receivingCenterOther', '');
          return;
        }

        onUpdate('receivingCenter', RECEIVING_CENTER_OTHER);
        onUpdate('receivingCenterOther', destinationHospital);
      } catch (error) {
        transferModalLogger.warn(
          'Failed to resolve linked transfer destination from management',
          error
        );
        if (active) {
          setLinkedDestinationHospital(null);
        }
      }
    };

    void syncDestinationFromTransferManagement();

    return () => {
      active = false;
    };
  }, [bedId, isEditing, isOpen, onUpdate]);

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
            isCenterLocked={Boolean(linkedDestinationHospital)}
            lockedCenterValue={linkedDestinationHospital || ''}
            otherCenterError={errors.otherCenter}
            onReceivingCenterChange={value => onUpdate('receivingCenter', value)}
            onReceivingCenterOtherChange={setReceivingCenterOther}
          />

          <TransferTimeField
            showDateInput={isEditing}
            dateValue={transferDate}
            value={transferTime}
            minDate={movementBounds.minDate}
            maxDate={movementBounds.maxDate}
            nextDay={movementBounds.nextDay}
            nextDayMaxTime={movementBounds.nextDayMaxTime}
            timeError={errors.time}
            dateTimeError={errors.dateTime}
            onDateChange={setTransferDate}
            onChange={setTransferTime}
          />
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
