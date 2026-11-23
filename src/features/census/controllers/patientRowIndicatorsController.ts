import { classifyPatientMovementForRecord } from '@/domain/clinical-episode/clinicalEpisode';
import type { PatientActionMenuIndicators } from '@/features/census/components/patient-row/patientRowActionContracts';
import { normalizeDateOnly } from '@/utils/clinicalDayUtils';

interface ResolveIsNewAdmissionForRecordParams {
  recordDate: string;
  firstSeenDate?: string;
  admissionDate?: string;
  admissionTime?: string;
}

export const resolveIsNewAdmissionForRecord = ({
  recordDate,
  firstSeenDate,
  admissionDate,
  admissionTime,
}: ResolveIsNewAdmissionForRecordParams): boolean => {
  const isNewAdmission = classifyPatientMovementForRecord(recordDate, {
    firstSeenDate,
    admissionDate,
    admissionTime,
  }).isNewAdmission;

  if (isNewAdmission) {
    return true;
  }

  // A madrugada admission belongs to the previous clinical day, where it already shows as new;
  // nurses also expect it marked on the calendar day it happened.
  const normalizedRecordDate = normalizeDateOnly(recordDate);
  const normalizedAdmissionDate = normalizeDateOnly(admissionDate);
  return Boolean(normalizedRecordDate) && normalizedAdmissionDate === normalizedRecordDate;
};

export interface PatientRowResolvedIndicators {
  hasClinicalDocument: boolean;
  isNewAdmission: boolean;
}

// Four immutable value combinations keep React.memo effective when another bed's
// document presence changes. No per-patient cache or custom row comparator.
const INDICATOR_VALUES = {
  none: Object.freeze({ hasClinicalDocument: false, isNewAdmission: false }),
  newOnly: Object.freeze({ hasClinicalDocument: false, isNewAdmission: true }),
  docOnly: Object.freeze({ hasClinicalDocument: true, isNewAdmission: false }),
  both: Object.freeze({ hasClinicalDocument: true, isNewAdmission: true }),
} as const;
const stableIndicators = (
  hasClinicalDocument: boolean,
  isNewAdmission: boolean
): PatientRowResolvedIndicators =>
  hasClinicalDocument
    ? isNewAdmission
      ? INDICATOR_VALUES.both
      : INDICATOR_VALUES.docOnly
    : isNewAdmission
      ? INDICATOR_VALUES.newOnly
      : INDICATOR_VALUES.none;

export const EMPTY_PATIENT_ROW_INDICATORS: PatientRowResolvedIndicators = stableIndicators(
  false,
  false
);

interface ResolvePatientRowIndicatorsParams {
  indicators?: PatientActionMenuIndicators;
  canShowClinicalDocumentIndicator: boolean;
}

export const resolvePatientRowIndicators = ({
  indicators,
  canShowClinicalDocumentIndicator,
}: ResolvePatientRowIndicatorsParams): PatientRowResolvedIndicators =>
  stableIndicators(
    Boolean(indicators?.hasClinicalDocument) && canShowClinicalDocumentIndicator,
    Boolean(indicators?.isNewAdmission)
  );

interface BuildOccupiedPatientRowIndicatorsParams {
  isSubRow: boolean;
  currentDateString: string;
  firstSeenDate?: string;
  admissionDate?: string;
  admissionTime?: string;
  hasClinicalDocument: boolean;
  /**
   * Whether this patient was discharged earlier on the same census day.
   * When true, the patient is a same-day readmission and the new-admission
   * badge is forced on regardless of the clinical day calculation.
   */
  wasDischargedSameDay?: boolean;
}

const buildMainRowIndicators = ({
  currentDateString,
  firstSeenDate,
  admissionDate,
  admissionTime,
  hasClinicalDocument,
  wasDischargedSameDay,
}: Omit<BuildOccupiedPatientRowIndicatorsParams, 'isSubRow'>): PatientRowResolvedIndicators =>
  stableIndicators(
    hasClinicalDocument,
    Boolean(wasDischargedSameDay) ||
      resolveIsNewAdmissionForRecord({
        recordDate: currentDateString,
        firstSeenDate,
        admissionDate,
        admissionTime,
      })
  );

export const buildOccupiedPatientRowIndicators = ({
  isSubRow,
  currentDateString,
  firstSeenDate,
  admissionDate,
  admissionTime,
  hasClinicalDocument,
  wasDischargedSameDay,
}: BuildOccupiedPatientRowIndicatorsParams): PatientRowResolvedIndicators => {
  if (isSubRow) {
    return EMPTY_PATIENT_ROW_INDICATORS;
  }

  return buildMainRowIndicators({
    currentDateString,
    firstSeenDate,
    admissionDate,
    admissionTime,
    hasClinicalDocument,
    wasDischargedSameDay,
  });
};
