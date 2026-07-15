import { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import type { DailyRecord } from '@/features/census/contracts/censusRecordContracts';
import type { PatientData } from '@/features/census/domain/movements/contracts/patient';
import type {
  DischargeAddCommandPayload,
  DischargeTarget,
  TransferCommandPayload,
} from '@/features/census/domain/movements/contracts';
import {
  AddDischargeMovementInput,
  AddTransferMovementInput,
} from '@/features/census/controllers/patientMovementCreationController';
import type { MovementProvenanceSeed } from '@/application/census/movementProvenancePolicy';

interface MovementCreationDependencies {
  bedsCatalog: readonly BedDefinition[];
  createEmptyPatient: (bedId: string) => PatientData;
}

interface BuildAddDischargeInputParams extends MovementCreationDependencies {
  record: DailyRecord;
  bedId: string;
  payload: DischargeAddCommandPayload;
  provenance?: MovementProvenanceSeed;
}

interface BuildAddTransferInputParams extends MovementCreationDependencies {
  record: DailyRecord;
  bedId: string;
  payload: TransferCommandPayload;
  provenance?: MovementProvenanceSeed;
}

interface BuildDischargeCommandPayloadParams {
  status: 'Vivo' | 'Fallecido';
  cribStatus?: 'Vivo' | 'Fallecido';
  dischargeType?: string;
  dischargeTypeOther?: string;
  time?: string;
  movementDate?: string;
  target: DischargeTarget;
}

interface BuildTransferCommandPayloadParams {
  method: string;
  center: string;
  centerOther: string;
  escort?: string;
  time?: string;
  movementDate?: string;
}

export const buildDischargeAddCommandPayload = ({
  status,
  cribStatus,
  dischargeType,
  dischargeTypeOther,
  time,
  movementDate,
  target,
}: BuildDischargeCommandPayloadParams): DischargeAddCommandPayload => ({
  status,
  cribStatus,
  type: dischargeType,
  typeOther: dischargeTypeOther,
  time: time || '',
  movementDate,
  dischargeTarget: target,
});

export const buildTransferCommandPayload = ({
  method,
  center,
  centerOther,
  escort,
  time,
  movementDate,
}: BuildTransferCommandPayloadParams): TransferCommandPayload => ({
  evacuationMethod: method,
  receivingCenter: center,
  receivingCenterOther: centerOther,
  transferEscort: escort || '',
  time: time || '',
  movementDate,
});

export const buildAddDischargeInput = ({
  record,
  bedId,
  payload,
  bedsCatalog,
  createEmptyPatient,
  provenance,
}: BuildAddDischargeInputParams): AddDischargeMovementInput => ({
  record,
  bedId,
  payload,
  bedsCatalog,
  createEmptyPatient,
  provenance,
});

export const buildAddTransferInput = ({
  record,
  bedId,
  payload,
  bedsCatalog,
  createEmptyPatient,
  provenance,
}: BuildAddTransferInputParams): AddTransferMovementInput => ({
  record,
  bedId,
  payload,
  bedsCatalog,
  createEmptyPatient,
  provenance,
});
