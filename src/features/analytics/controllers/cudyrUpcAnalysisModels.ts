import {
  resolveCudyrCareLevel,
  type CudyrCareLevelBedGroupDistribution,
  type CudyrCareLevelDistribution,
} from '@/features/analytics/controllers/cudyrCareLevelController';

export type HhrUpcClinicalCriteriaKey = 'upc_uci' | 'upc_uti' | 'upc_legacy';

export interface HhrUpcCareLevelDistribution extends CudyrCareLevelDistribution {
  key: HhrUpcClinicalCriteriaKey;
  label: string;
}

export type CudyrUpcCohortKey =
  | 'basic'
  | 'adult_potential_without_upc'
  | 'neonatal_without_upc'
  | 'upc_uti'
  | 'upc_uci'
  | 'upc_legacy';

export interface CudyrUpcCohortSummary {
  key: CudyrUpcCohortKey;
  label: string;
  description: string;
  categorizedObservations: number;
  critical: number;
  medium: number;
  basic: number;
}

export interface CudyrUpcDailySummary {
  date: string;
  adultPotentialOccupied: number;
  adultPotentialWithCriteria: number;
  adultPotentialWithoutCriteria: number;
  adultPotentialLegacy: number;
  adultPotentialWithUpc: number;
  neonatalOccupied: number;
  neonatalWithCriteria: number;
  neonatalWithUpc: number;
  basicOccupied: number;
  upcUti: number;
  upcUci: number;
  categorizedObservations: number;
}

export interface CudyrUpcAnalysis {
  periodStart: string;
  periodEnd: string;
  daysWithRecords: number;
  eligibleObservations: number;
  excludedUnidentifiedObservations: number;
  categorizedObservations: number;
  coveragePercent: number;
  adultPotentialOccupied: number;
  adultPotentialWithCriteria: number;
  adultPotentialWithoutCriteria: number;
  adultPotentialLegacy: number;
  adultPotentialWithUpc: number;
  adultCriteriaPercent: number;
  adultUpcPercent: number;
  neonatalOccupied: number;
  neonatalWithCriteria: number;
  neonatalWithUpc: number;
  neonatalWithoutCriteria: number;
  neonatalLegacy: number;
  basicOccupied: number;
  upcWithCriteria: number;
  upcObserved: number;
  upcUti: number;
  upcUci: number;
  upcLegacy: number;
  upcAssumedUti: number;
  upcOutsideEligibleBeds: number;
  nonUpcCareLevels: CudyrCareLevelDistribution;
  nonUpcCareLevelsByBedGroup: CudyrCareLevelBedGroupDistribution[];
  upcCareLevelsByClinicalCriteria: HhrUpcCareLevelDistribution[];
  cohorts: CudyrUpcCohortSummary[];
  daily: CudyrUpcDailySummary[];
}

const createCohort = (
  key: CudyrUpcCohortKey,
  label: string,
  description: string
): CudyrUpcCohortSummary => ({
  key,
  label,
  description,
  categorizedObservations: 0,
  critical: 0,
  medium: 0,
  basic: 0,
});

export const createCudyrUpcCohorts = (): Record<CudyrUpcCohortKey, CudyrUpcCohortSummary> => ({
  basic: createCohort('basic', 'Camas básicas', 'H1C1–H6C2, sin criterio UPC registrado'),
  adult_potential_without_upc: createCohort(
    'adult_potential_without_upc',
    'R1–R4 sin criterio UPC',
    'Uso de cama potencialmente UTI sin clasificación clínica UTI/UCI'
  ),
  neonatal_without_upc: createCohort(
    'neonatal_without_upc',
    'NEO 1–2 sin criterio UPC',
    'Cama neonatal habilitada para evaluar UPC, sin clasificación UTI/UCI'
  ),
  upc_uti: createCohort(
    'upc_uti',
    'UPC–UTI',
    'Paciente con al menos un criterio clínico UTI registrado'
  ),
  upc_uci: createCohort(
    'upc_uci',
    'UPC–UCI',
    'Paciente con al menos un criterio clínico UCI registrado'
  ),
  upc_legacy: createCohort(
    'upc_legacy',
    'UPC histórico sin desglose',
    'Marcación UPC antigua sin clasificación estructurada UTI/UCI'
  ),
});

export const addCudyrCategoryToCohort = (cohort: CudyrUpcCohortSummary, category: string) => {
  const careLevel = resolveCudyrCareLevel(category);
  if (!careLevel) return;
  cohort.categorizedObservations += 1;
  if (careLevel === 'CRITICAL') cohort.critical += 1;
  else if (careLevel === 'MEDIUM') cohort.medium += 1;
  else cohort.basic += 1;
};
