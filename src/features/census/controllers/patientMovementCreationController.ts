import {
  BedDefinition,
  DailyRecord,
  DischargeData,
  DischargeType,
  PatientData,
  TransferData,
} from '@/types';
import type {
  DischargeAddCommandPayload,
  TransferCommandPayload,
} from '@/features/census/domain/movements/contracts';
import {
  ControllerError,
  ControllerResult,
  failWithCode,
  ok,
} from '@/features/census/controllers/controllerResult';
import { resolveMovementDisplayDate } from '@/features/census/controllers/censusMovementDatePresentationController';

export type MovementCreationErrorCode = 'BED_NOT_FOUND' | 'SOURCE_BED_EMPTY';

export type MovementCreationError = ControllerError<MovementCreationErrorCode>;

interface MovementAuditEntry {
  bedId: string;
  patientName: string;
  rut: string;
  status: 'Vivo' | 'Fallecido';
}

export interface AddDischargeMovementInput {
  record: DailyRecord;
  bedId: string;
  payload: DischargeAddCommandPayload;
  bedsCatalog: readonly BedDefinition[];
  createEmptyPatient: (bedId: string) => PatientData;
  createId?: () => string;
}

export interface AddTransferMovementInput {
  record: DailyRecord;
  bedId: string;
  payload: TransferCommandPayload;
  bedsCatalog: readonly BedDefinition[];
  createEmptyPatient: (bedId: string) => PatientData;
  createId?: () => string;
}

type AddDischargeMovementResult = ControllerResult<
  { updatedRecord: DailyRecord; auditEntries: MovementAuditEntry[] },
  MovementCreationErrorCode,
  MovementCreationError
>;

type AddTransferMovementResult = ControllerResult<
  {
    updatedRecord: DailyRecord;
    auditEntry: { bedId: string; patientName: string; rut: string; receivingCenter: string };
  },
  MovementCreationErrorCode,
  MovementCreationError
>;

const clonePatientSnapshot = (patient: PatientData): PatientData =>
  JSON.parse(JSON.stringify(patient)) as PatientData;

const resolveBedDefinition = (
  bedId: string,
  bedsCatalog: readonly BedDefinition[]
): BedDefinition | undefined => bedsCatalog.find(bed => bed.id === bedId);

const defaultCreateId = (): string => crypto.randomUUID();

export const resolveAddDischargeMovement = ({
  record,
  bedId,
  payload,
  bedsCatalog,
  createEmptyPatient,
  createId = defaultCreateId,
}: AddDischargeMovementInput): AddDischargeMovementResult => {
  const {
    status,
    cribStatus,
    type: dischargeType,
    typeOther: dischargeTypeOther,
    time,
    movementDate,
    dischargeTarget: target = 'both',
  } = payload;
  const patient = record.beds[bedId];
  if (!patient) {
    return failWithCode('BED_NOT_FOUND', `No existe la cama ${bedId} en el registro actual.`);
  }
  if (!patient.patientName) {
    return failWithCode('SOURCE_BED_EMPTY', `No se puede dar de alta una cama vacia: ${bedId}.`);
  }

  const bedDef = resolveBedDefinition(bedId, bedsCatalog);
  const resolvedMovementDate = resolveMovementDisplayDate(record.date, movementDate, time);
  const newDischarges: DischargeData[] = [];
  const auditEntries: MovementAuditEntry[] = [];
  const updatedBeds = { ...record.beds };

  if (target === 'mother' || target === 'both') {
    newDischarges.push({
      id: createId(),
      movementDate: resolvedMovementDate,
      bedName: bedDef?.name || bedId,
      bedId,
      bedType: bedDef?.type || '',
      patientName: patient.patientName,
      rut: patient.rut,
      diagnosis: patient.pathology,
      time: time || '',
      status,
      dischargeType: status === 'Vivo' ? (dischargeType as DischargeType) : undefined,
      dischargeTypeOther: dischargeType === 'Otra' ? dischargeTypeOther : undefined,
      age: patient.age,
      insurance: patient.insurance,
      origin: patient.origin,
      isRapanui: patient.isRapanui,
      originalData: clonePatientSnapshot(patient),
      isNested: false,
    });
    auditEntries.push({
      bedId,
      patientName: patient.patientName,
      rut: patient.rut,
      status,
    });
  }

  if ((target === 'baby' || target === 'both') && patient.clinicalCrib?.patientName && cribStatus) {
    newDischarges.push({
      id: createId(),
      movementDate: resolvedMovementDate,
      bedName: `${bedDef?.name || bedId} (Cuna)`,
      bedId,
      bedType: 'Cuna',
      patientName: patient.clinicalCrib.patientName,
      rut: patient.clinicalCrib.rut,
      diagnosis: patient.clinicalCrib.pathology,
      time: time || '',
      status: cribStatus,
      age: patient.clinicalCrib.age,
      insurance: patient.insurance,
      origin: patient.origin,
      isRapanui: patient.isRapanui,
      originalData: clonePatientSnapshot(patient.clinicalCrib),
      isNested: true,
    });
    auditEntries.push({
      bedId,
      patientName: patient.clinicalCrib.patientName,
      rut: patient.clinicalCrib.rut,
      status: cribStatus,
    });
  }

  if (target === 'both') {
    const cleanPatient = createEmptyPatient(bedId);
    cleanPatient.location = updatedBeds[bedId].location;
    updatedBeds[bedId] = cleanPatient;
  } else if (target === 'mother') {
    if (patient.clinicalCrib?.patientName) {
      updatedBeds[bedId] = {
        ...createEmptyPatient(bedId),
        ...patient.clinicalCrib,
        location: patient.location,
        bedMode: 'Cuna',
        clinicalCrib: undefined,
        hasCompanionCrib: false,
      };
    } else {
      const cleanPatient = createEmptyPatient(bedId);
      cleanPatient.location = updatedBeds[bedId].location;
      updatedBeds[bedId] = cleanPatient;
    }
  } else if (target === 'baby') {
    updatedBeds[bedId] = {
      ...patient,
      clinicalCrib: undefined,
    };
  }

  return ok({
    updatedRecord: {
      ...record,
      beds: updatedBeds,
      discharges: [...(record.discharges || []), ...newDischarges],
    },
    auditEntries,
  });
};

export const resolveAddTransferMovement = ({
  record,
  bedId,
  payload,
  bedsCatalog,
  createEmptyPatient,
  createId = defaultCreateId,
}: AddTransferMovementInput): AddTransferMovementResult => {
  const {
    evacuationMethod: method,
    receivingCenter: center,
    receivingCenterOther: centerOther,
    transferEscort: escort,
    time,
    movementDate,
  } = payload;
  const patient = record.beds[bedId];
  if (!patient) {
    return failWithCode('BED_NOT_FOUND', `No existe la cama ${bedId} en el registro actual.`);
  }
  if (!patient.patientName) {
    return failWithCode('SOURCE_BED_EMPTY', `No se puede trasladar una cama vacia: ${bedId}.`);
  }

  const bedDef = resolveBedDefinition(bedId, bedsCatalog);
  const resolvedMovementDate = resolveMovementDisplayDate(record.date, movementDate, time);
  const newTransfers: TransferData[] = [];

  newTransfers.push({
    id: createId(),
    movementDate: resolvedMovementDate,
    bedName: bedDef?.name || bedId,
    bedId,
    bedType: bedDef?.type || '',
    patientName: patient.patientName,
    rut: patient.rut,
    diagnosis: patient.pathology,
    time: time || '',
    evacuationMethod: method,
    receivingCenter: center,
    receivingCenterOther: centerOther,
    transferEscort: escort,
    age: patient.age,
    insurance: patient.insurance,
    origin: patient.origin,
    isRapanui: patient.isRapanui,
    originalData: clonePatientSnapshot(patient),
    isNested: false,
  });

  if (patient.clinicalCrib?.patientName) {
    newTransfers.push({
      id: createId(),
      movementDate: resolvedMovementDate,
      bedName: `${bedDef?.name || bedId} (Cuna)`,
      bedId,
      bedType: 'Cuna',
      patientName: patient.clinicalCrib.patientName,
      rut: patient.clinicalCrib.rut,
      diagnosis: patient.clinicalCrib.pathology,
      time: time || '',
      evacuationMethod: method,
      receivingCenter: center,
      receivingCenterOther: centerOther,
      transferEscort: escort,
      age: patient.clinicalCrib.age,
      insurance: patient.insurance,
      origin: patient.origin,
      isRapanui: patient.isRapanui,
      originalData: clonePatientSnapshot(patient.clinicalCrib),
      isNested: true,
    });
  }

  const updatedBeds = { ...record.beds };
  const cleanPatient = createEmptyPatient(bedId);
  cleanPatient.location = updatedBeds[bedId].location;
  updatedBeds[bedId] = cleanPatient;

  return ok({
    updatedRecord: {
      ...record,
      beds: updatedBeds,
      transfers: [...(record.transfers || []), ...newTransfers],
    },
    auditEntry: {
      bedId,
      patientName: patient.patientName,
      rut: patient.rut,
      receivingCenter: center,
    },
  });
};
