import { DailyRecord, DischargeType, TransferData } from '@/types';

interface UpdateDischargeMovementInput {
  record: DailyRecord;
  id: string;
  status: 'Vivo' | 'Fallecido';
  dischargeType?: string;
  dischargeTypeOther?: string;
  time?: string;
  movementDate?: string;
}

interface DeleteMovementInput {
  record: DailyRecord;
  id: string;
}

interface UpdateTransferMovementInput {
  record: DailyRecord;
  id: string;
  updates: Partial<TransferData>;
}

export const resolveUpdateDischargeMovement = ({
  record,
  id,
  status,
  dischargeType,
  dischargeTypeOther,
  time,
  movementDate,
}: UpdateDischargeMovementInput): DailyRecord => {
  const discharges = record.discharges.map(discharge =>
    discharge.id === id
      ? {
          ...discharge,
          status,
          dischargeType: status === 'Vivo' ? (dischargeType as DischargeType) : undefined,
          dischargeTypeOther: dischargeType === 'Otra' ? dischargeTypeOther : undefined,
          movementDate: movementDate ?? discharge.movementDate,
          time: time ?? discharge.time,
        }
      : discharge
  );

  return {
    ...record,
    discharges,
  };
};

export const resolveDeleteDischargeMovement = ({
  record,
  id,
}: DeleteMovementInput): DailyRecord => ({
  ...record,
  discharges: record.discharges.filter(discharge => discharge.id !== id),
});

export const resolveUpdateTransferMovement = ({
  record,
  id,
  updates,
}: UpdateTransferMovementInput): DailyRecord => ({
  ...record,
  transfers: record.transfers.map(transfer =>
    transfer.id === id ? { ...transfer, ...updates } : transfer
  ),
});

export const resolveDeleteTransferMovement = ({
  record,
  id,
}: DeleteMovementInput): DailyRecord => ({
  ...record,
  transfers: record.transfers.filter(transfer => transfer.id !== id),
});
