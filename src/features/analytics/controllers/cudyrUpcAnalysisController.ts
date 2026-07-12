import { isCudyrPatientEligible } from '@/domain/cudyr/cudyrEligibility';
import { resolveUpcClassification, type UpcClassification } from '@/domain/upc/upcClassification';
import { getCategorization } from '@/services/cudyr/CudyrScoreUtils';
import type { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';
import {
  addMinsalEquivalence,
  createMinsalBedGroupDistributions,
  createMinsalDistribution,
  finalizeMinsalDistribution,
  resolveMinsalCudyrEquivalence,
  resolveNonHhrUpcBedGroup,
  type MinsalCudyrBedGroupDistribution,
  type MinsalCudyrDistribution,
} from '@/features/analytics/controllers/cudyrMinsalEquivalenceController';

const ADULT_POTENTIAL_UTI_BEDS = new Set(['R1', 'R2', 'R3', 'R4']);
const NEONATAL_UPC_ELIGIBLE_BEDS = new Set(['NEO1', 'NEO2']);
export const isUpcEligibleAnalyticsBed = (bedId: string): boolean =>
  ADULT_POTENTIAL_UTI_BEDS.has(bedId) || NEONATAL_UPC_ELIGIBLE_BEDS.has(bedId);
const BASIC_BEDS = new Set(
  Array.from({ length: 6 }, (_, roomIndex) => [`H${roomIndex + 1}C1`, `H${roomIndex + 1}C2`]).flat()
);
const ANALYZED_BEDS = new Set([
  ...ADULT_POTENTIAL_UTI_BEDS,
  ...NEONATAL_UPC_ELIGIBLE_BEDS,
  ...BASIC_BEDS,
]);

export type CudyrRiskLevel = 'A' | 'B' | 'C' | 'D';
export type CudyrDependencyLevel = '1' | '2' | '3';
export type AnalyticsUpcClassification = UpcClassification | 'UPC_LEGACY';
export const LEGACY_UPC_UTI_CUTOFF_DATE = '2026-04-30';

export const isLegacyUpcAssumedUti = (
  date: string,
  classification: AnalyticsUpcClassification
): boolean => classification === 'UPC_LEGACY' && date < LEGACY_UPC_UTI_CUTOFF_DATE;
export type HhrUpcClinicalCriteriaKey = 'upc_uci' | 'upc_uti';

export interface HhrUpcMinsalDistribution extends MinsalCudyrDistribution {
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
  risk: Record<CudyrRiskLevel, number>;
  dependency: Record<CudyrDependencyLevel, number>;
}

export interface CudyrUpcDailySummary {
  date: string;
  adultPotentialOccupied: number;
  adultPotentialWithCriteria: number;
  adultPotentialWithoutCriteria: number;
  adultPotentialLegacy: number;
  neonatalOccupied: number;
  neonatalWithCriteria: number;
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
  categorizedObservations: number;
  coveragePercent: number;
  adultPotentialOccupied: number;
  adultPotentialWithCriteria: number;
  adultPotentialWithoutCriteria: number;
  adultPotentialLegacy: number;
  adultCriteriaPercent: number;
  neonatalOccupied: number;
  neonatalWithCriteria: number;
  neonatalWithoutCriteria: number;
  neonatalLegacy: number;
  basicOccupied: number;
  upcWithCriteria: number;
  upcUti: number;
  upcUci: number;
  upcLegacy: number;
  upcAssumedUti: number;
  upcOutsideEligibleBeds: number;
  nonHhrUpcMinsal: MinsalCudyrDistribution;
  nonHhrUpcMinsalByBedGroup: MinsalCudyrBedGroupDistribution[];
  hhrUpcMinsalByClinicalCriteria: HhrUpcMinsalDistribution[];
  cohorts: CudyrUpcCohortSummary[];
  daily: CudyrUpcDailySummary[];
}

type AnalyticsPatient = DailyRecord['beds'][string];

const createRiskCounts = (): Record<CudyrRiskLevel, number> => ({
  A: 0,
  B: 0,
  C: 0,
  D: 0,
});

const createDependencyCounts = (): Record<CudyrDependencyLevel, number> => ({
  1: 0,
  2: 0,
  3: 0,
});

const createCohort = (
  key: CudyrUpcCohortKey,
  label: string,
  description: string
): CudyrUpcCohortSummary => ({
  key,
  label,
  description,
  categorizedObservations: 0,
  risk: createRiskCounts(),
  dependency: createDependencyCounts(),
});

const createCohorts = (): Record<CudyrUpcCohortKey, CudyrUpcCohortSummary> => ({
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

export const resolveAnalyticsUpcClassification = (
  patient: AnalyticsPatient
): AnalyticsUpcClassification => {
  const storedClassification = patient.upcChecklist?.classification;
  if (storedClassification === 'UPC_UTI' || storedClassification === 'UPC_UCI') {
    return storedClassification;
  }

  if (patient.upcChecklist) {
    const derivedClassification = resolveUpcClassification({
      uciCriteria: patient.upcChecklist.uciCriteria ?? [],
      utiCriteria: patient.upcChecklist.utiCriteria ?? [],
    });
    if (derivedClassification) {
      return derivedClassification;
    }
  }

  return patient.isUPC ? 'UPC_LEGACY' : null;
};

const resolveCohortKey = (
  bedId: string,
  classification: AnalyticsUpcClassification
): CudyrUpcCohortKey => {
  if (classification === 'UPC_UCI') return 'upc_uci';
  if (classification === 'UPC_UTI') return 'upc_uti';
  if (classification === 'UPC_LEGACY') return 'upc_legacy';
  if (ADULT_POTENTIAL_UTI_BEDS.has(bedId)) return 'adult_potential_without_upc';
  if (NEONATAL_UPC_ELIGIBLE_BEDS.has(bedId)) return 'neonatal_without_upc';
  return 'basic';
};

const addCategorizationToCohort = (
  cohort: CudyrUpcCohortSummary,
  riskLevel: string,
  dependencyLevel: string
) => {
  if (!['A', 'B', 'C', 'D'].includes(riskLevel)) return;
  if (!['1', '2', '3'].includes(dependencyLevel)) return;

  cohort.categorizedObservations += 1;
  cohort.risk[riskLevel as CudyrRiskLevel] += 1;
  cohort.dependency[dependencyLevel as CudyrDependencyLevel] += 1;
};

const roundPercent = (value: number, total: number): number =>
  total > 0 ? Math.round((value / total) * 1000) / 10 : 0;

export const buildCudyrUpcAnalysis = (records: DailyRecord[]): CudyrUpcAnalysis => {
  const sortedRecords = records.slice().sort((left, right) => left.date.localeCompare(right.date));
  const cohorts = createCohorts();
  const nonHhrUpcMinsal = createMinsalDistribution();
  const nonHhrUpcMinsalByBedGroup = createMinsalBedGroupDistributions();
  const hhrUpcMinsalByClinicalCriteria: Record<
    HhrUpcClinicalCriteriaKey,
    HhrUpcMinsalDistribution
  > = {
    upc_uci: {
      ...createMinsalDistribution(),
      key: 'upc_uci',
      label: 'Calificados UPC–UCI por criterios HHR',
    },
    upc_uti: {
      ...createMinsalDistribution(),
      key: 'upc_uti',
      label: 'Calificados UPC–UTI por criterios HHR',
    },
  };
  const daily: CudyrUpcDailySummary[] = [];

  let eligibleObservations = 0;
  let categorizedObservations = 0;
  let adultPotentialOccupied = 0;
  let adultPotentialWithCriteria = 0;
  let adultPotentialWithoutCriteria = 0;
  let adultPotentialLegacy = 0;
  let neonatalOccupied = 0;
  let neonatalWithCriteria = 0;
  let neonatalWithoutCriteria = 0;
  let neonatalLegacy = 0;
  let basicOccupied = 0;
  let upcUti = 0;
  let upcUci = 0;
  let upcLegacy = 0;
  let upcAssumedUti = 0;
  let upcOutsideEligibleBeds = 0;

  sortedRecords.forEach(record => {
    const day: CudyrUpcDailySummary = {
      date: record.date,
      adultPotentialOccupied: 0,
      adultPotentialWithCriteria: 0,
      adultPotentialWithoutCriteria: 0,
      adultPotentialLegacy: 0,
      neonatalOccupied: 0,
      neonatalWithCriteria: 0,
      basicOccupied: 0,
      upcUti: 0,
      upcUci: 0,
      categorizedObservations: 0,
    };

    ANALYZED_BEDS.forEach(bedId => {
      const patient = record.beds[bedId];
      if (!patient || !isCudyrPatientEligible(record.date, patient)) return;

      eligibleObservations += 1;
      const storedClassification = resolveAnalyticsUpcClassification(patient);
      const hasInvalidUpcBedLabel =
        storedClassification !== null && !isUpcEligibleAnalyticsBed(bedId);
      const classification = hasInvalidUpcBedLabel ? null : storedClassification;
      const hasStructuredCriteria = classification === 'UPC_UTI' || classification === 'UPC_UCI';
      const isAssumedLegacyUti = isLegacyUpcAssumedUti(record.date, classification);

      if (hasInvalidUpcBedLabel) upcOutsideEligibleBeds += 1;

      if (ADULT_POTENTIAL_UTI_BEDS.has(bedId)) {
        adultPotentialOccupied += 1;
        day.adultPotentialOccupied += 1;
        if (hasStructuredCriteria) {
          adultPotentialWithCriteria += 1;
          day.adultPotentialWithCriteria += 1;
        } else if (classification === 'UPC_LEGACY') {
          adultPotentialLegacy += 1;
          day.adultPotentialLegacy += 1;
        } else {
          adultPotentialWithoutCriteria += 1;
          day.adultPotentialWithoutCriteria += 1;
        }
      } else if (NEONATAL_UPC_ELIGIBLE_BEDS.has(bedId)) {
        neonatalOccupied += 1;
        day.neonatalOccupied += 1;
        if (hasStructuredCriteria) {
          neonatalWithCriteria += 1;
          day.neonatalWithCriteria += 1;
        } else if (classification === 'UPC_LEGACY') {
          neonatalLegacy += 1;
        } else {
          neonatalWithoutCriteria += 1;
        }
      } else if (BASIC_BEDS.has(bedId)) {
        basicOccupied += 1;
        day.basicOccupied += 1;
      }

      if (classification === 'UPC_UTI') {
        upcUti += 1;
        day.upcUti += 1;
      } else if (classification === 'UPC_UCI') {
        upcUci += 1;
        day.upcUci += 1;
      } else if (classification === 'UPC_LEGACY') {
        upcLegacy += 1;
        if (isAssumedLegacyUti) {
          upcAssumedUti += 1;
          upcUti += 1;
          day.upcUti += 1;
        }
      }

      const categorization = getCategorization(patient.cudyr);

      if (classification === 'UPC_UCI' || classification === 'UPC_UTI') {
        const clinicalDistribution =
          hhrUpcMinsalByClinicalCriteria[classification === 'UPC_UCI' ? 'upc_uci' : 'upc_uti'];
        clinicalDistribution.eligibleObservations += 1;
        if (categorization.isCategorized) {
          addMinsalEquivalence(
            clinicalDistribution,
            resolveMinsalCudyrEquivalence(categorization.finalCat)
          );
        }
      }

      if (classification === null) {
        const bedGroupDistribution = nonHhrUpcMinsalByBedGroup[resolveNonHhrUpcBedGroup(bedId)];
        nonHhrUpcMinsal.eligibleObservations += 1;
        bedGroupDistribution.eligibleObservations += 1;

        if (categorization.isCategorized) {
          const equivalence = resolveMinsalCudyrEquivalence(categorization.finalCat);
          addMinsalEquivalence(nonHhrUpcMinsal, equivalence);
          addMinsalEquivalence(bedGroupDistribution, equivalence);
        }
      }

      if (!categorization.isCategorized) return;

      categorizedObservations += 1;
      day.categorizedObservations += 1;
      addCategorizationToCohort(
        cohorts[resolveCohortKey(bedId, classification)],
        categorization.riskCat,
        categorization.depCat
      );
    });

    daily.push(day);
  });

  return {
    periodStart: sortedRecords[0]?.date ?? '',
    periodEnd: sortedRecords.at(-1)?.date ?? '',
    daysWithRecords: sortedRecords.length,
    eligibleObservations,
    categorizedObservations,
    coveragePercent: roundPercent(categorizedObservations, eligibleObservations),
    adultPotentialOccupied,
    adultPotentialWithCriteria,
    adultPotentialWithoutCriteria,
    adultPotentialLegacy,
    adultCriteriaPercent: roundPercent(adultPotentialWithCriteria, adultPotentialOccupied),
    neonatalOccupied,
    neonatalWithCriteria,
    neonatalWithoutCriteria,
    neonatalLegacy,
    basicOccupied,
    upcWithCriteria: upcUti - upcAssumedUti + upcUci,
    upcUti,
    upcUci,
    upcLegacy,
    upcAssumedUti,
    upcOutsideEligibleBeds,
    nonHhrUpcMinsal: finalizeMinsalDistribution(nonHhrUpcMinsal),
    nonHhrUpcMinsalByBedGroup: Object.values(nonHhrUpcMinsalByBedGroup).map(
      finalizeMinsalDistribution
    ),
    hhrUpcMinsalByClinicalCriteria: Object.values(hhrUpcMinsalByClinicalCriteria).map(
      finalizeMinsalDistribution
    ),
    cohorts: Object.values(cohorts),
    daily,
  };
};
