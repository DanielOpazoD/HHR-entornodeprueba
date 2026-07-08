import type { DailyRecord } from '@/features/census/contracts/censusRecordContracts';
import { DischargeData, TransferData } from '@/features/census/contracts/censusMovementContracts';
import type { PatientData } from '@/features/census/domain/movements/contracts/patient';

export interface UndoMovementDescriptor {
  id: string;
  bedId: string;
  bedName: string;
  patientName: string;
  isNested?: boolean;
  originalData?: PatientData;
}

const findMovementById = <T extends { id: string }>(
  movements: readonly T[],
  movementId: string
): T | undefined => movements.find(movement => movement.id === movementId);

export const selectDischargeUndoMovement = (
  record: DailyRecord,
  movementId: string
): UndoMovementDescriptor | undefined =>
  findMovementById<DischargeData>(record.discharges, movementId);

export const selectTransferUndoMovement = (
  record: DailyRecord,
  movementId: string
): UndoMovementDescriptor | undefined =>
  findMovementById<TransferData>(record.transfers, movementId);

export interface MovementUndoAuditMetadata {
  patientName: string;
  rut: string | undefined;
}

export const selectMovementUndoAuditMetadata = (
  movement: UndoMovementDescriptor,
  updatedBed: PatientData
): MovementUndoAuditMetadata => ({
  patientName: updatedBed.patientName || movement.patientName,
  rut: updatedBed.rut || movement.originalData?.rut,
});
