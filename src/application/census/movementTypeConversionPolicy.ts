import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type { CMAData, DischargeData } from '@/types/domain/movements';
import {
  getActiveCma,
  getActiveDischarges,
  tombstoneMovementById,
} from './movementTombstonePolicy';

type CreateId = () => string;

const DEFAULT_CMA_INTERVENTION_TYPE: CMAData['interventionType'] = 'Cirugía Mayor Ambulatoria';
const DEFAULT_HOME_DISCHARGE_TYPE: DischargeData['dischargeType'] = 'Domicilio (Habitual)';

const findActiveDischargeById = (record: DailyRecord, id: string): DischargeData | undefined =>
  getActiveDischarges(record.discharges).find(item => item.id === id);

const findActiveCmaById = (record: DailyRecord, id: string): CMAData | undefined =>
  getActiveCma(record.cma).find(item => item.id === id);

export const canConvertDischargeToCma = (
  discharge: Pick<DischargeData, 'status' | 'dischargeType'>
): boolean =>
  discharge.status === 'Vivo' && discharge.dischargeType === DEFAULT_HOME_DISCHARGE_TYPE;

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
  item: CMAData,
  record: DailyRecord,
  createId: CreateId
): DischargeData => ({
  id: createId(),
  movementDate: record.date,
  admissionDate: item.originalData?.admissionDate,
  clinicalEpisodeId: item.clinicalEpisodeId,
  bedName: item.bedName,
  bedId: item.originalBedId || item.id,
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

export const convertDischargeToCmaRecord = (
  record: DailyRecord,
  dischargeId: string,
  createId: CreateId
): DailyRecord => {
  const discharge = findActiveDischargeById(record, dischargeId);
  if (!discharge || !canConvertDischargeToCma(discharge)) {
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

export const convertCmaToHomeDischargeRecord = (
  record: DailyRecord,
  cmaId: string,
  createId: CreateId
): DailyRecord => {
  const item = findActiveCmaById(record, cmaId);
  if (!item) {
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
