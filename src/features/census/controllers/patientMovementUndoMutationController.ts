import { DailyRecord, PatientData } from '@/types';

interface ApplyUndoDischargeInput {
  record: DailyRecord;
  dischargeId: string;
  bedId: string;
  updatedBed: PatientData;
}

interface ApplyUndoTransferInput {
  record: DailyRecord;
  transferId: string;
  bedId: string;
  updatedBed: PatientData;
}

export const resolveApplyUndoDischargeRecord = ({
  record,
  dischargeId,
  bedId,
  updatedBed,
}: ApplyUndoDischargeInput): DailyRecord => ({
  ...record,
  beds: {
    ...record.beds,
    [bedId]: updatedBed,
  },
  discharges: record.discharges.filter(discharge => discharge.id !== dischargeId),
});

export const resolveApplyUndoTransferRecord = ({
  record,
  transferId,
  bedId,
  updatedBed,
}: ApplyUndoTransferInput): DailyRecord => ({
  ...record,
  beds: {
    ...record.beds,
    [bedId]: updatedBed,
  },
  transfers: record.transfers.filter(transfer => transfer.id !== transferId),
});
