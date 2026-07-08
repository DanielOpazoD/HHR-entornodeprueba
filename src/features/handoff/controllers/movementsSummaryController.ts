import type { CMAData, DischargeData, TransferData } from '@/types/domain/movements';
import type { ShiftType } from '@/types/domain/shift';
import { isWithinDayShift } from '@/utils/shiftTimeUtils';
import type { DailyRecord } from '@/domain/handoff/recordContracts';
import {
  getActiveCma,
  getActiveDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';

interface ShiftMovement {
  time?: string;
}

export const isMovementInSelectedShift = (
  movement: ShiftMovement,
  selectedShift: ShiftType
): boolean => {
  // Legacy entries without time are interpreted as day-shift records.
  if (!movement.time) {
    return selectedShift === 'day';
  }

  const isDayTime = isWithinDayShift(movement.time);
  return selectedShift === 'day' ? isDayTime : !isDayTime;
};

export const filterDischargesByShift = (
  discharges: DischargeData[] | undefined,
  selectedShift: ShiftType
): DischargeData[] =>
  getActiveDischarges(discharges).filter(discharge =>
    isMovementInSelectedShift(discharge, selectedShift)
  );

export const filterTransfersByShift = (
  transfers: TransferData[] | undefined,
  selectedShift: ShiftType
): TransferData[] =>
  getActiveTransfers(transfers).filter(transfer =>
    isMovementInSelectedShift(transfer, selectedShift)
  );

export const filterCmaByShift = (
  cma: CMAData[] | undefined,
  selectedShift: ShiftType
): CMAData[] => (selectedShift === 'night' ? [] : getActiveCma(cma));

export const resolveMovementEmptyMessage = (
  kind: 'discharges' | 'transfers' | 'cma',
  selectedShift: ShiftType
): string => {
  if (kind === 'cma') {
    return selectedShift === 'night'
      ? 'CMA solo aplica para turno de día.'
      : 'No hay pacientes de CMA hoy.';
  }

  if (kind === 'discharges') {
    return selectedShift === 'day'
      ? 'No hay altas registradas en este turno.'
      : 'No hay altas registradas durante la noche.';
  }

  return selectedShift === 'day'
    ? 'No hay traslados registrados en este turno.'
    : 'No hay traslados registrados durante la noche.';
};

export const resolveTransferDestinationLabel = (
  transfer: Pick<TransferData, 'receivingCenter' | 'receivingCenterOther'>
): string =>
  transfer.receivingCenter === 'Otro'
    ? transfer.receivingCenterOther || 'Otro'
    : transfer.receivingCenter;

export const resolveTransferEscortLabel = (
  transfer: Pick<TransferData, 'evacuationMethod' | 'transferEscort'>
): string => (transfer.evacuationMethod === 'Aerocardal' ? '-' : transfer.transferEscort || '-');

export interface MovementSectionViewModel<TItem> {
  items: TItem[];
  emptyMessage: string;
}

export interface MovementsSummaryViewModel {
  discharges: MovementSectionViewModel<DischargeData>;
  transfers: MovementSectionViewModel<TransferData>;
  cma: MovementSectionViewModel<CMAData>;
}

export const buildMovementsSummaryViewModel = ({
  record,
  selectedShift,
}: {
  record: Pick<DailyRecord, 'discharges' | 'transfers' | 'cma'>;
  selectedShift: ShiftType;
}): MovementsSummaryViewModel => ({
  discharges: {
    items: filterDischargesByShift(record.discharges, selectedShift),
    emptyMessage: resolveMovementEmptyMessage('discharges', selectedShift),
  },
  transfers: {
    items: filterTransfersByShift(record.transfers, selectedShift),
    emptyMessage: resolveMovementEmptyMessage('transfers', selectedShift),
  },
  cma: {
    items: filterCmaByShift(record.cma, selectedShift),
    emptyMessage: resolveMovementEmptyMessage('cma', selectedShift),
  },
});
