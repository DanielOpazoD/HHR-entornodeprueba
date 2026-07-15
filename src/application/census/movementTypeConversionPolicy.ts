import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type { CMAData, DischargeData, TransferData } from '@/types/domain/movements';
import {
  getActiveCma,
  getActiveDischarges,
  getActiveTransfers,
  tombstoneMovementById,
} from './movementTombstonePolicy';

type CreateId = () => string;
type CmaWithOriginalBed = CMAData & { originalBedId: string };

const hasOriginalBed = (item: CMAData | undefined): item is CmaWithOriginalBed =>
  Boolean(item?.originalBedId?.trim());

const DEFAULT_CMA_INTERVENTION_TYPE: CMAData['interventionType'] = 'Cirugía Mayor Ambulatoria';
const DEFAULT_HOME_DISCHARGE_TYPE: DischargeData['dischargeType'] = 'Domicilio (Habitual)';

const findActiveDischargeById = (record: DailyRecord, id: string): DischargeData | undefined =>
  getActiveDischarges(record.discharges).find(item => item.id === id);

const findActiveCmaById = (record: DailyRecord, id: string): CMAData | undefined =>
  getActiveCma(record.cma).find(item => item.id === id);

const findActiveTransferById = (record: DailyRecord, id: string): TransferData | undefined =>
  getActiveTransfers(record.transfers).find(item => item.id === id);

export const canReclassifyHomeDischarge = (
  discharge: Pick<DischargeData, 'status' | 'dischargeType'>
): boolean =>
  discharge.status === 'Vivo' && discharge.dischargeType === DEFAULT_HOME_DISCHARGE_TYPE;

/** Backward-compatible name used by existing callers. */
export const canConvertDischargeToCma = canReclassifyHomeDischarge;

const buildCmaFromDischarge = (discharge: DischargeData, createId: CreateId): CMAData => ({
  id: createId(),
  bedName: discharge.bedName,
  patientName: discharge.patientName,
  rut: discharge.rut,
  age: discharge.age || '',
  birthDate: discharge.originalData?.birthDate,
  biologicalSex: discharge.originalData?.biologicalSex,
  insurance: (discharge.insurance || discharge.originalData?.insurance) as CMAData['insurance'],
  admissionOrigin: discharge.originalData?.admissionOrigin,
  admissionOriginDetails: discharge.originalData?.admissionOriginDetails,
  origin: (discharge.origin || discharge.originalData?.origin) as CMAData['origin'],
  isRapanui: discharge.isRapanui ?? discharge.originalData?.isRapanui,
  diagnosis: discharge.diagnosis,
  cie10Code: discharge.originalData?.cie10Code,
  cie10Description: discharge.originalData?.cie10Description,
  specialty: discharge.specialty || '',
  interventionType: DEFAULT_CMA_INTERVENTION_TYPE,
  dischargeTime: discharge.time,
  timestamp: new Date().toISOString(),
  originalBedId: discharge.bedId,
  originalData: discharge.originalData,
  clinicalEpisodeId: discharge.clinicalEpisodeId,
});

const buildDischargeFromCma = (
  item: CmaWithOriginalBed,
  record: DailyRecord,
  createId: CreateId
): DischargeData => ({
  id: createId(),
  movementDate: record.date,
  admissionDate: item.originalData?.admissionDate,
  clinicalEpisodeId: item.clinicalEpisodeId,
  bedName: item.bedName,
  bedId: item.originalBedId,
  bedType: '',
  patientName: item.patientName,
  rut: item.rut,
  diagnosis: item.diagnosis,
  specialty: item.specialty,
  time: item.dischargeTime || '',
  status: 'Vivo',
  dischargeType: DEFAULT_HOME_DISCHARGE_TYPE,
  age: item.age,
  insurance: item.insurance,
  origin: item.origin,
  isRapanui: item.isRapanui,
  originalData: item.originalData,
  isNested: false,
});

const buildTransferFromDischarge = (item: DischargeData, createId: CreateId): TransferData => ({
  id: createId(),
  movementDate: item.movementDate,
  admissionDate: item.admissionDate,
  clinicalEpisodeId: item.clinicalEpisodeId,
  bedName: item.bedName,
  bedId: item.bedId,
  bedType: item.bedType,
  patientName: item.patientName,
  rut: item.rut,
  diagnosis: item.diagnosis,
  specialty: item.specialty,
  time: item.time,
  evacuationMethod: '',
  receivingCenter: '',
  age: item.age,
  insurance: item.insurance,
  origin: item.origin,
  isRapanui: item.isRapanui,
  originalData: item.originalData,
  isNested: item.isNested,
});

const buildDischargeFromTransfer = (item: TransferData, createId: CreateId): DischargeData => ({
  id: createId(),
  movementDate: item.movementDate,
  admissionDate: item.admissionDate,
  clinicalEpisodeId: item.clinicalEpisodeId,
  bedName: item.bedName,
  bedId: item.bedId,
  bedType: item.bedType,
  patientName: item.patientName,
  rut: item.rut,
  diagnosis: item.diagnosis,
  specialty: item.specialty,
  time: item.time,
  status: 'Vivo',
  dischargeType: DEFAULT_HOME_DISCHARGE_TYPE,
  age: item.age,
  insurance: item.insurance,
  origin: item.origin,
  isRapanui: item.isRapanui,
  originalData: item.originalData,
  isNested: item.isNested,
});

const buildCmaFromTransfer = (item: TransferData, createId: CreateId): CMAData => ({
  id: createId(),
  bedName: item.bedName,
  patientName: item.patientName,
  rut: item.rut,
  age: item.age || '',
  birthDate: item.originalData?.birthDate,
  biologicalSex: item.originalData?.biologicalSex,
  insurance: (item.insurance || item.originalData?.insurance) as CMAData['insurance'],
  admissionOrigin: item.originalData?.admissionOrigin,
  admissionOriginDetails: item.originalData?.admissionOriginDetails,
  origin: (item.origin || item.originalData?.origin) as CMAData['origin'],
  isRapanui: item.isRapanui ?? item.originalData?.isRapanui,
  diagnosis: item.diagnosis,
  cie10Code: item.originalData?.cie10Code,
  cie10Description: item.originalData?.cie10Description,
  specialty: item.specialty || '',
  interventionType: DEFAULT_CMA_INTERVENTION_TYPE,
  dischargeTime: item.time,
  timestamp: new Date().toISOString(),
  originalBedId: item.bedId,
  originalData: item.originalData,
  clinicalEpisodeId: item.clinicalEpisodeId,
});

const buildTransferFromCma = (
  item: CmaWithOriginalBed,
  record: DailyRecord,
  createId: CreateId
): TransferData => ({
  id: createId(),
  movementDate: record.date,
  admissionDate: item.originalData?.admissionDate,
  clinicalEpisodeId: item.clinicalEpisodeId,
  bedName: item.bedName,
  bedId: item.originalBedId,
  bedType: '',
  patientName: item.patientName,
  rut: item.rut,
  diagnosis: item.diagnosis,
  specialty: item.specialty,
  time: item.dischargeTime || '',
  evacuationMethod: '',
  receivingCenter: '',
  age: item.age,
  insurance: item.insurance,
  origin: item.origin,
  isRapanui: item.isRapanui,
  originalData: item.originalData,
  isNested: false,
});

export const convertDischargeToCmaRecord = (
  record: DailyRecord,
  dischargeId: string,
  createId: CreateId
): DailyRecord => {
  const discharge = findActiveDischargeById(record, dischargeId);
  if (!discharge || !canReclassifyHomeDischarge(discharge)) {
    return record;
  }

  return {
    ...record,
    discharges: tombstoneMovementById(record.discharges, dischargeId, {
      deletedReason: 'converted_to_cma',
    }),
    cma: [...(record.cma || []), buildCmaFromDischarge(discharge, createId)],
  };
};

export const convertDischargeToTransferRecord = (
  record: DailyRecord,
  dischargeId: string,
  createId: CreateId
): DailyRecord => {
  const discharge = findActiveDischargeById(record, dischargeId);
  if (!discharge || !canReclassifyHomeDischarge(discharge)) return record;

  return {
    ...record,
    discharges: tombstoneMovementById(record.discharges, dischargeId, {
      deletedReason: 'converted_to_transfer',
    }),
    transfers: [...(record.transfers || []), buildTransferFromDischarge(discharge, createId)],
  };
};

export const convertCmaToHomeDischargeRecord = (
  record: DailyRecord,
  cmaId: string,
  createId: CreateId
): DailyRecord => {
  const item = findActiveCmaById(record, cmaId);
  if (!hasOriginalBed(item)) {
    return record;
  }

  return {
    ...record,
    cma: tombstoneMovementById(record.cma, cmaId, {
      deletedReason: 'converted_to_discharge',
    }),
    discharges: [...(record.discharges || []), buildDischargeFromCma(item, record, createId)],
  };
};

export const convertCmaToTransferRecord = (
  record: DailyRecord,
  cmaId: string,
  createId: CreateId
): DailyRecord => {
  const item = findActiveCmaById(record, cmaId);
  if (!hasOriginalBed(item)) return record;

  return {
    ...record,
    cma: tombstoneMovementById(record.cma, cmaId, {
      deletedReason: 'converted_to_transfer',
    }),
    transfers: [...(record.transfers || []), buildTransferFromCma(item, record, createId)],
  };
};

export const convertTransferToHomeDischargeRecord = (
  record: DailyRecord,
  transferId: string,
  createId: CreateId
): DailyRecord => {
  const item = findActiveTransferById(record, transferId);
  if (!item) return record;

  return {
    ...record,
    transfers: tombstoneMovementById(record.transfers, transferId, {
      deletedReason: 'converted_to_discharge',
    }),
    discharges: [...(record.discharges || []), buildDischargeFromTransfer(item, createId)],
  };
};

export const convertTransferToCmaRecord = (
  record: DailyRecord,
  transferId: string,
  createId: CreateId
): DailyRecord => {
  const item = findActiveTransferById(record, transferId);
  if (!item) return record;

  return {
    ...record,
    transfers: tombstoneMovementById(record.transfers, transferId, {
      deletedReason: 'converted_to_cma',
    }),
    cma: [...(record.cma || []), buildCmaFromTransfer(item, createId)],
  };
};
