import { BedDefinition, DailyRecord, PatientData } from '@/types';
import type {
  DischargeAddCommandPayload,
  DischargeTarget,
  TransferCommandPayload,
} from '@/features/census/domain/movements/contracts';
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
  payload: DischargeAddCommandPayload;
}

interface BuildAddTransferInputParams extends MovementCreationDependencies {
  record: DailyRecord;
  bedId: string;
  payload: TransferCommandPayload;
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
}: BuildAddDischargeInputParams): AddDischargeMovementInput => ({
  record,
  bedId,
  payload,
  bedsCatalog,
  createEmptyPatient,
});

export const buildAddTransferInput = ({
  record,
  bedId,
  payload,
  bedsCatalog,
  createEmptyPatient,
}: BuildAddTransferInputParams): AddTransferMovementInput => ({
  record,
  bedId,
  payload,
  bedsCatalog,
  createEmptyPatient,
});
