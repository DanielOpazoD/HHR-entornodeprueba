import { getNextDay, normalizeDateOnly, parseTimeMinutes } from '@/utils/clinicalDayUtils';

export const CUDYR_NIGHT_REFERENCE_TIME = '01:00';
export const CUDYR_NIGHT_REFERENCE_TIME_LABEL = '01:00';
export const CUDYR_MIN_HOSPITALIZATION_HOURS = 8;
const CUDYR_SAME_DAY_CUTOFF_MINUTES = 17 * 60;

export interface CudyrEligibilityResolution {
  isEligible: boolean;
  isBlocked: boolean;
  blockedReason?: string;
}

interface ResolveCudyrEligibilityParams {
  recordDate: string;
  patientName?: string;
  admissionDate?: string;
  admissionTime?: string;
}

interface CudyrEligibilityPatientRef {
  patientName?: string;
  admissionDate?: string;
  admissionTime?: string;
  isBlocked?: boolean;
}

const buildBlockedEligibility = (blockedReason: string): CudyrEligibilityResolution => ({
  isEligible: false,
  isBlocked: true,
  blockedReason,
});

export const hasVisibleCudyrPatientName = (patientName?: string | null): boolean =>
  Boolean(patientName?.trim());

export const resolveCudyrEligibility = ({
  recordDate,
  patientName,
  admissionDate,
  admissionTime,
}: ResolveCudyrEligibilityParams): CudyrEligibilityResolution => {
  if (!hasVisibleCudyrPatientName(patientName)) {
    return { isEligible: false, isBlocked: false };
  }

  const normalizedRecordDate = normalizeDateOnly(recordDate);
  const normalizedAdmissionDate = normalizeDateOnly(admissionDate);

  if (!normalizedRecordDate || !normalizedAdmissionDate) {
    return buildBlockedEligibility('Sin fecha de ingreso para evaluar CUDYR.');
  }

  if (normalizedAdmissionDate < normalizedRecordDate) {
    return { isEligible: true, isBlocked: false };
  }

  if (normalizedAdmissionDate > normalizedRecordDate) {
    return buildBlockedEligibility(
      `Ingreso menor a ${CUDYR_MIN_HOSPITALIZATION_HOURS} h al corte fijo ${CUDYR_NIGHT_REFERENCE_TIME}.`
    );
  }

  const admissionMinutes = parseTimeMinutes(admissionTime);
  if (admissionMinutes === null) {
    return { isEligible: true, isBlocked: false };
  }

  if (admissionMinutes > CUDYR_SAME_DAY_CUTOFF_MINUTES) {
    return buildBlockedEligibility(
      `Ingreso menor a ${CUDYR_MIN_HOSPITALIZATION_HOURS} h al corte fijo ${CUDYR_NIGHT_REFERENCE_TIME}.`
    );
  }

  return { isEligible: true, isBlocked: false };
};

export const isCudyrPatientEligible = (
  recordDate: string,
  patient?: CudyrEligibilityPatientRef | null
): boolean => {
  if (!patient || !hasVisibleCudyrPatientName(patient.patientName) || patient.isBlocked) {
    return false;
  }

  return resolveCudyrEligibility({
    recordDate,
    patientName: patient.patientName,
    admissionDate: patient.admissionDate,
    admissionTime: patient.admissionTime,
  }).isEligible;
};

export const resolveCudyrNightApplicationDate = (recordDate: string): string =>
  getNextDay(recordDate);
