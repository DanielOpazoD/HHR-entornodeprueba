import { resolveCudyrEligibility } from '@/domain/cudyr/cudyrEligibility';
import { resolveUpcClassification, type UpcClassification } from '@/domain/upc/upcClassification';
import { getCategorization } from '@/services/cudyr/CudyrScoreUtils';
import type { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';
import {
  addCareLevel,
  createCareLevelBedGroupDistributions,
  createCareLevelDistribution,
  finalizeCareLevelDistribution,
  resolveCareLevelBedGroup,
  resolveCudyrCareLevel,
} from '@/features/analytics/controllers/cudyrCareLevelController';
import { hasAnalyticsPatientIdentity } from '@/features/analytics/controllers/analyticsPatientIdentity';
import {
  addCudyrCategoryToCohort,
  createCudyrUpcCohorts,
  type CudyrUpcAnalysis,
  type CudyrUpcCohortKey,
  type CudyrUpcDailySummary,
  type HhrUpcCareLevelDistribution,
  type HhrUpcClinicalCriteriaKey,
} from '@/features/analytics/controllers/cudyrUpcAnalysisModels';

export type {
  CudyrUpcAnalysis,
  HhrUpcCareLevelDistribution,
} from '@/features/analytics/controllers/cudyrUpcAnalysisModels';

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

export type AnalyticsUpcClassification = UpcClassification | 'UPC_LEGACY';
export const LEGACY_UPC_UTI_CUTOFF_DATE = '2026-04-30';

export const isLegacyUpcAssumedUti = (
  date: string,
  classification: AnalyticsUpcClassification
): boolean => classification === 'UPC_LEGACY' && date < LEGACY_UPC_UTI_CUTOFF_DATE;

type AnalyticsPatient = DailyRecord['beds'][string];

const isCudyrAnalyticsEligible = (recordDate: string, patient: AnalyticsPatient): boolean =>
  !patient.isBlocked &&
  resolveCudyrEligibility({
    recordDate,
    patientName: patient.patientName || patient.rut,
    admissionDate: patient.admissionDate,
    admissionTime: patient.admissionTime,
  }).isEligible;

const isCudyrTimingEligibleWithoutIdentity = (
  recordDate: string,
  patient: AnalyticsPatient
): boolean =>
  !patient.isBlocked &&
  resolveCudyrEligibility({
    recordDate,
    // The identity rule is evaluated separately; this call only applies the
    // admission-date and nightly-cutoff gates to an otherwise anonymous UPC row.
    patientName: 'observación UPC pendiente de identidad',
    admissionDate: patient.admissionDate,
    admissionTime: patient.admissionTime,
  }).isEligible;

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

const roundPercent = (value: number, total: number): number =>
  total > 0 ? Math.round((value / total) * 1000) / 10 : 0;

export const buildCudyrUpcAnalysis = (records: DailyRecord[]): CudyrUpcAnalysis => {
  const sortedRecords = records.slice().sort((left, right) => left.date.localeCompare(right.date));
  const cohorts = createCudyrUpcCohorts();
  const nonUpcCareLevels = createCareLevelDistribution();
  const nonUpcCareLevelsByBedGroup = createCareLevelBedGroupDistributions();
  const upcCareLevelsByClinicalCriteria: Record<
    HhrUpcClinicalCriteriaKey,
    HhrUpcCareLevelDistribution
  > = {
    upc_uci: {
      ...createCareLevelDistribution(),
      key: 'upc_uci',
      label: 'Calificados UPC–UCI por criterios HHR',
    },
    upc_uti: {
      ...createCareLevelDistribution(),
      key: 'upc_uti',
      label: 'Calificados UPC–UTI por criterios HHR',
    },
    upc_legacy: {
      ...createCareLevelDistribution(),
      key: 'upc_legacy',
      label: 'UPC histórico sin desglose',
    },
  };
  const daily: CudyrUpcDailySummary[] = [];

  let eligibleObservations = 0;
  let excludedUnidentifiedObservations = 0;
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
      adultPotentialWithUpc: 0,
      neonatalOccupied: 0,
      neonatalWithCriteria: 0,
      neonatalWithUpc: 0,
      basicOccupied: 0,
      upcUti: 0,
      upcUci: 0,
      categorizedObservations: 0,
    };

    ANALYZED_BEDS.forEach(bedId => {
      const patient = record.beds[bedId];
      if (!patient) return;
      const storedClassification = resolveAnalyticsUpcClassification(patient);
      const hasInvalidUpcBedLabel =
        storedClassification !== null && !isUpcEligibleAnalyticsBed(bedId);
      if (
        storedClassification !== null &&
        !hasInvalidUpcBedLabel &&
        !hasAnalyticsPatientIdentity(patient)
      ) {
        if (!isCudyrTimingEligibleWithoutIdentity(record.date, patient)) return;
        excludedUnidentifiedObservations += 1;
        return;
      }
      if (!isCudyrAnalyticsEligible(record.date, patient)) return;

      eligibleObservations += 1;
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
          day.adultPotentialWithUpc += 1;
        } else if (classification === 'UPC_LEGACY') {
          adultPotentialLegacy += 1;
          day.adultPotentialLegacy += 1;
          day.adultPotentialWithUpc += 1;
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
          day.neonatalWithUpc += 1;
        } else if (classification === 'UPC_LEGACY') {
          neonatalLegacy += 1;
          day.neonatalWithUpc += 1;
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

      if (classification !== null) {
        const distributionKey =
          classification === 'UPC_UCI'
            ? 'upc_uci'
            : classification === 'UPC_UTI'
              ? 'upc_uti'
              : 'upc_legacy';
        const clinicalDistribution = upcCareLevelsByClinicalCriteria[distributionKey];
        clinicalDistribution.eligibleObservations += 1;
        if (categorization.isCategorized) {
          addCareLevel(clinicalDistribution, resolveCudyrCareLevel(categorization.finalCat));
        }
      }

      if (classification === null) {
        const bedGroupDistribution = nonUpcCareLevelsByBedGroup[resolveCareLevelBedGroup(bedId)];
        nonUpcCareLevels.eligibleObservations += 1;
        bedGroupDistribution.eligibleObservations += 1;

        if (categorization.isCategorized) {
          const careLevel = resolveCudyrCareLevel(categorization.finalCat);
          addCareLevel(nonUpcCareLevels, careLevel);
          addCareLevel(bedGroupDistribution, careLevel);
        }
      }

      if (!categorization.isCategorized) return;

      categorizedObservations += 1;
      day.categorizedObservations += 1;
      addCudyrCategoryToCohort(
        cohorts[resolveCohortKey(bedId, classification)],
        categorization.finalCat
      );
    });

    daily.push(day);
  });

  return {
    periodStart: sortedRecords[0]?.date ?? '',
    periodEnd: sortedRecords.at(-1)?.date ?? '',
    daysWithRecords: sortedRecords.length,
    eligibleObservations,
    excludedUnidentifiedObservations,
    categorizedObservations,
    coveragePercent: roundPercent(categorizedObservations, eligibleObservations),
    adultPotentialOccupied,
    adultPotentialWithCriteria,
    adultPotentialWithoutCriteria,
    adultPotentialLegacy,
    adultPotentialWithUpc: adultPotentialWithCriteria + adultPotentialLegacy,
    adultCriteriaPercent: roundPercent(adultPotentialWithCriteria, adultPotentialOccupied),
    adultUpcPercent: roundPercent(
      adultPotentialWithCriteria + adultPotentialLegacy,
      adultPotentialOccupied
    ),
    neonatalOccupied,
    neonatalWithCriteria,
    neonatalWithUpc: neonatalWithCriteria + neonatalLegacy,
    neonatalWithoutCriteria,
    neonatalLegacy,
    basicOccupied,
    upcWithCriteria: upcUti - upcAssumedUti + upcUci,
    upcObserved: upcUti - upcAssumedUti + upcUci + upcLegacy,
    upcUti,
    upcUci,
    upcLegacy,
    upcAssumedUti,
    upcOutsideEligibleBeds,
    nonUpcCareLevels: finalizeCareLevelDistribution(nonUpcCareLevels),
    nonUpcCareLevelsByBedGroup: Object.values(nonUpcCareLevelsByBedGroup).map(
      finalizeCareLevelDistribution
    ),
    upcCareLevelsByClinicalCriteria: Object.values(upcCareLevelsByClinicalCriteria).map(
      finalizeCareLevelDistribution
    ),
    cohorts: Object.values(cohorts),
    daily,
  };
};
