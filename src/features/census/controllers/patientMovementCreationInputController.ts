import { BedDefinition, DailyRecord, PatientData } from '@/types';
import type { DischargeTarget } from '@/features/census/domain/movements/contracts';
import {
  AddDischargeMovementInput,
  AddTransferMovementInput,
} from '@/features/census/controllers/patientMovementCreationController';

interface MovementCreationDependencies {
  bedsCatalog: readonly BedDefinition[];
  createEmptyPatient: (bedId: string) => PatientData;
}

interface BuildAddDischargeInputParams extends MovementCreationDependencies {
  record: DailyRecord;
  bedId: string;
  status: 'Vivo' | 'Fallecido';
  cribStatus?: 'Vivo' | 'Fallecido';
  dischargeType?: string;
  dischargeTypeOther?: string;
  time?: string;
  movementDate?: string;
  target: DischargeTarget;
}

interface BuildAddTransferInputParams extends MovementCreationDependencies {
  record: DailyRecord;
  bedId: string;
  method: string;
  center: string;
  centerOther: string;
  escort?: string;
  time?: string;
  movementDate?: string;
}

export const buildAddDischargeInput = ({
  record,
  bedId,
  status,
  cribStatus,
  dischargeType,
  dischargeTypeOther,
  time,
  movementDate,
  target,
  bedsCatalog,
  createEmptyPatient,
}: BuildAddDischargeInputParams): AddDischargeMovementInput => ({
  record,
  bedId,
  status,
  cribStatus,
  dischargeType,
  dischargeTypeOther,
  time,
  movementDate,
  target,
  bedsCatalog,
  createEmptyPatient,
});

export const buildAddTransferInput = ({
  record,
  bedId,
  method,
  center,
  centerOther,
  escort,
  time,
  movementDate,
  bedsCatalog,
  createEmptyPatient,
}: BuildAddTransferInputParams): AddTransferMovementInput => ({
  record,
  bedId,
  method,
  center,
  centerOther,
  escort,
  time,
  movementDate,
  bedsCatalog,
  createEmptyPatient,
});
