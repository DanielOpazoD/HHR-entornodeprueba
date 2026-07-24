import { UPC_UCI_CRITERIA, UPC_UTI_CRITERIA } from '@/domain/upc/upcCriteria';
import type { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';
import {
  isLegacyUpcAssumedUti,
  isUpcEligibleAnalyticsBed,
  resolveAnalyticsUpcClassification,
} from '@/features/analytics/controllers/cudyrUpcAnalysisController';
import { hasAnalyticsPatientIdentity } from '@/features/analytics/controllers/analyticsPatientIdentity';
import { getCategorization } from '@/services/cudyr/CudyrScoreUtils';

export type StructuredUpcClassification = 'UPC_UCI' | 'UPC_UTI';
export type UpcClinicalBedGroupKey = 'adult_potential' | 'neonatal' | 'other';

export interface UpcClinicalDetail {
  id: string;
  date: string;
  bedId: string;
  patientName: string;
  rut: string;
  diagnosis: string;
  specialty: string;
  classification: StructuredUpcClassification;
  classificationSource: 'structured_checklist' | 'legacy_manual_upc';
  cudyrCategory: string;
  criteria: string[];
}

export interface UpcClinicalBedGroupSummary {
  key: UpcClinicalBedGroupKey;
  label: string;
  uti: number;
  uci: number;
  total: number;
}

export interface UpcClinicalAnalytics {
  uniquePatients: number;
  uniqueUtiPatients: number;
  uniqueUciPatients: number;
  observations: number;
  utiObservations: number;
  uciObservations: number;
  assumedUtiObservations: number;
  excludedUnidentifiedObservations: number;
  utiPercent: number;
  uciPercent: number;
  byBedGroup: UpcClinicalBedGroupSummary[];
  details: UpcClinicalDetail[];
}

const CRITERIA_LABELS = new Map(
  [...UPC_UCI_CRITERIA, ...UPC_UTI_CRITERIA].map(criterion => [criterion.id, criterion.label])
);

const roundPercent = (value: number, total: number): number =>
  total > 0 ? Math.round((value / total) * 1000) / 10 : 0;

const resolveBedGroup = (bedId: string): UpcClinicalBedGroupKey => {
  if (['R1', 'R2', 'R3', 'R4'].includes(bedId)) return 'adult_potential';
  if (['NEO1', 'NEO2'].includes(bedId)) return 'neonatal';
  return 'other';
};

const resolvePatientKey = (
  patient: DailyRecord['beds'][string],
  bedId: string,
  classification: StructuredUpcClassification
): string =>
  `${patient.clinicalEpisodeId || patient.rut || `${patient.patientName}-${patient.admissionDate}-${bedId}`}::${classification}`;

export const buildUpcClinicalAnalytics = (records: DailyRecord[]): UpcClinicalAnalytics => {
  const details: UpcClinicalDetail[] = [];
  const uniqueAll = new Set<string>();
  const uniqueUti = new Set<string>();
  const uniqueUci = new Set<string>();
  const bedGroups: Record<UpcClinicalBedGroupKey, UpcClinicalBedGroupSummary> = {
    adult_potential: { key: 'adult_potential', label: 'R1–R4', uti: 0, uci: 0, total: 0 },
    neonatal: { key: 'neonatal', label: 'NEO1–NEO2', uti: 0, uci: 0, total: 0 },
    other: { key: 'other', label: 'Otras camas', uti: 0, uci: 0, total: 0 },
  };
  let utiObservations = 0;
  let uciObservations = 0;
  let assumedUtiObservations = 0;
  let excludedUnidentifiedObservations = 0;

  records
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date))
    .forEach(record => {
      Object.entries(record.beds).forEach(([bedId, patient]) => {
        if (!patient) return;
        if (!isUpcEligibleAnalyticsBed(bedId)) return;
        const storedClassification = resolveAnalyticsUpcClassification(patient);
        const legacyAssumedUti = isLegacyUpcAssumedUti(record.date, storedClassification);
        const classification = legacyAssumedUti ? 'UPC_UTI' : storedClassification;
        if (classification !== 'UPC_UCI' && classification !== 'UPC_UTI') return;
        if (!hasAnalyticsPatientIdentity(patient)) {
          excludedUnidentifiedObservations += 1;
          return;
        }

        const patientKey = resolvePatientKey(patient, bedId, classification);
        uniqueAll.add(patientKey.replace(/::UPC_(UCI|UTI)$/, ''));
        const bedGroup = bedGroups[resolveBedGroup(bedId)];
        bedGroup.total += 1;

        if (classification === 'UPC_UCI') {
          uciObservations += 1;
          uniqueUci.add(patientKey);
          bedGroup.uci += 1;
        } else {
          utiObservations += 1;
          if (legacyAssumedUti) assumedUtiObservations += 1;
          uniqueUti.add(patientKey);
          bedGroup.uti += 1;
        }

        const checklist = patient.upcChecklist;
        const criterionIds = [...(checklist?.uciCriteria ?? []), ...(checklist?.utiCriteria ?? [])];
        const categorization = getCategorization(patient.cudyr);

        details.push({
          id: `${record.date}-${bedId}-${patientKey}`,
          date: record.date,
          bedId,
          patientName: patient.patientName || '',
          rut: patient.rut || '',
          diagnosis: patient.pathology || '',
          specialty: String(patient.specialty || ''),
          classification,
          classificationSource: legacyAssumedUti ? 'legacy_manual_upc' : 'structured_checklist',
          cudyrCategory: categorization.isCategorized ? categorization.finalCat : '',
          criteria: legacyAssumedUti
            ? ['Registro manual “UPC” sin desglose UTI/UCI']
            : criterionIds.map(id => CRITERIA_LABELS.get(id) || id),
        });
      });
    });

  const observations = utiObservations + uciObservations;
  return {
    uniquePatients: uniqueAll.size,
    uniqueUtiPatients: uniqueUti.size,
    uniqueUciPatients: uniqueUci.size,
    observations,
    utiObservations,
    uciObservations,
    assumedUtiObservations,
    excludedUnidentifiedObservations,
    utiPercent: roundPercent(utiObservations, observations),
    uciPercent: roundPercent(uciObservations, observations),
    byBedGroup: Object.values(bedGroups),
    details,
  };
};
