import type { DailyRecord } from '@/features/census/contracts/censusRecordContracts';
import { tombstoneMovementById } from '@/application/census/movementTombstonePolicy';
import {
  DischargeType,
  TransferData,
  type IeehData,
} from '@/features/census/contracts/censusMovementContracts';

interface UpdateDischargeMovementInput {
  record: DailyRecord;
  id: string;
  status: 'Vivo' | 'Fallecido';
  dischargeType?: string;
  dischargeTypeOther?: string;
  time?: string;
  movementDate?: string;
  ieehData?: IeehData;
  diagnosis?: string;
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
  ieehData,
  diagnosis,
}: UpdateDischargeMovementInput): DailyRecord => {
  const discharges = record.discharges.map(discharge =>
    discharge.id === id
      ? {
          ...discharge,
          status,
          dischargeType:
            status === 'Vivo'
              ? ((dischargeType ?? discharge.dischargeType) as DischargeType | undefined)
              : undefined,
          dischargeTypeOther:
            status === 'Vivo' && dischargeType === 'Otra'
              ? dischargeTypeOther
              : status === 'Vivo' &&
                  dischargeType === undefined &&
                  discharge.dischargeType === 'Otra'
                ? discharge.dischargeTypeOther
                : undefined,
          movementDate: movementDate ?? discharge.movementDate,
          time: time ?? discharge.time,
          ieehData: ieehData ?? discharge.ieehData,
          diagnosis: diagnosis ?? discharge.diagnosis,
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
  discharges: tombstoneMovementById(record.discharges, id),
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
  transfers: tombstoneMovementById(record.transfers, id),
});
