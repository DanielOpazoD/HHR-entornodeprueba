import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type {
  CMAData,
  DischargeData,
  MovementClassification,
  TransferData,
} from '@/types/domain/movements';
import {
  buildReclassifiedMovementProvenance,
  stableReclassifiedMovementId,
} from './movementProvenancePolicy';

export type MovementCreateId = () => string;
export type CmaWithOriginalBed = CMAData & { originalBedId: string };

export interface MovementReclassificationContext {
  actor?: string;
  at?: string;
}

const DEFAULT_CMA_INTERVENTION_TYPE: CMAData['interventionType'] = 'Cirugía Mayor Ambulatoria';
export const DEFAULT_HOME_DISCHARGE_TYPE: DischargeData['dischargeType'] = 'Domicilio (Habitual)';

export const hasOriginalBed = (item: CMAData | undefined): item is CmaWithOriginalBed =>
  Boolean(item?.originalBedId?.trim());

const reclassificationAt = (context?: MovementReclassificationContext): string =>
  context?.at ?? new Date().toISOString();

const reclassifiedId = (
  item: { id: string },
  target: MovementClassification,
  createId: MovementCreateId
): string => stableReclassifiedMovementId(item.id, target, createId);

const reclassifiedProvenance = (
  item: DischargeData | TransferData | CMAData,
  previousClassification: MovementClassification,
  context?: MovementReclassificationContext
) =>
  buildReclassifiedMovementProvenance({
    previousMovementId: item.id,
    previousClassification,
    previousProvenance: item.movementProvenance,
    actor: context?.actor,
    at: reclassificationAt(context),
  });

export const buildCmaFromDischarge = (
  discharge: DischargeData,
  createId: MovementCreateId,
  context?: MovementReclassificationContext
): CMAData => ({
  id: reclassifiedId(discharge, 'cma', createId),
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
  movementProvenance: reclassifiedProvenance(discharge, 'discharge', context),
});

export const buildDischargeFromCma = (
  item: CmaWithOriginalBed,
  record: DailyRecord,
  createId: MovementCreateId,
  context?: MovementReclassificationContext
): DischargeData => ({
  id: reclassifiedId(item, 'discharge', createId),
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
  movementProvenance: reclassifiedProvenance(item, 'cma', context),
});

export const buildTransferFromDischarge = (
  item: DischargeData,
  createId: MovementCreateId,
  context?: MovementReclassificationContext
): TransferData => ({
  id: reclassifiedId(item, 'transfer', createId),
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
  movementProvenance: reclassifiedProvenance(item, 'discharge', context),
});

export const buildDischargeFromTransfer = (
  item: TransferData,
  createId: MovementCreateId,
  context?: MovementReclassificationContext
): DischargeData => ({
  id: reclassifiedId(item, 'discharge', createId),
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
  movementProvenance: reclassifiedProvenance(item, 'transfer', context),
});

export const buildCmaFromTransfer = (
  item: TransferData,
  createId: MovementCreateId,
  context?: MovementReclassificationContext
): CMAData => ({
  id: reclassifiedId(item, 'cma', createId),
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
  movementProvenance: reclassifiedProvenance(item, 'transfer', context),
});

export const buildTransferFromCma = (
  item: CmaWithOriginalBed,
  record: DailyRecord,
  createId: MovementCreateId,
  context?: MovementReclassificationContext
): TransferData => ({
  id: reclassifiedId(item, 'transfer', createId),
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
  movementProvenance: reclassifiedProvenance(item, 'cma', context),
});
