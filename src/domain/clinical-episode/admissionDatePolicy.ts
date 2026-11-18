import {
  getNextDay,
  getPreviousDay,
  normalizeDateOnly,
  parseTimeMinutes,
  resolveClinicalDayBounds,
} from '@/utils/clinicalDayUtils';

export interface AdmissionDatePolicyInput {
  recordDate: string;
  admissionDate?: string;
  admissionTime?: string;
  firstSeenDate?: string;
}

export interface AdmissionDateAuditResolution {
  baseDate: string;
  candidateDates: string[];
  suggestedAdmissionDate: string;
  isSuspicious: boolean;
  message?: string;
}

export interface AdmissionDateValidationPatient {
  patientName?: string;
  rut?: string;
  admissionDate?: string;
  admissionTime?: string;
  firstSeenDate?: string;
}

export interface AdmissionDatePersistenceViolation {
  path: string;
  patientName: string;
  rut: string;
  message: string;
  currentAdmissionDate?: string;
  attemptedAdmissionDate?: string;
  firstSeenDate?: string;
}

export class AdmissionDatePolicyViolationError extends Error {
  readonly violations: AdmissionDatePersistenceViolation[];

  constructor(message: string, violations: AdmissionDatePersistenceViolation[]) {
    super(message);
    this.name = 'AdmissionDatePolicyViolationError';
    this.violations = violations;
  }
}

const hasIdentity = (
  patient?: AdmissionDateValidationPatient
): patient is Required<Pick<AdmissionDateValidationPatient, 'patientName' | 'rut'>> &
  AdmissionDateValidationPatient => Boolean(patient?.patientName?.trim() && patient?.rut?.trim());

export const resolveAdmissionDateSuggestion = (
  baseDate?: string,
  admissionTime?: string
): string => {
  const normalizedBaseDate = normalizeDateOnly(baseDate);
  if (!normalizedBaseDate) return '';

  const timeMinutes = parseTimeMinutes(admissionTime);
  if (timeMinutes === null) {
    return normalizedBaseDate;
  }

  const { nightEndMinutes } = resolveClinicalDayBounds(normalizedBaseDate);
  return timeMinutes < nightEndMinutes ? getNextDay(normalizedBaseDate) : normalizedBaseDate;
};

export const resolveAdmissionDateAudit = ({
  recordDate,
  admissionDate,
  admissionTime,
  firstSeenDate,
}: AdmissionDatePolicyInput): AdmissionDateAuditResolution => {
  const baseDate = normalizeDateOnly(firstSeenDate) ?? normalizeDateOnly(recordDate) ?? '';
  if (!baseDate) {
    return {
      baseDate: '',
      candidateDates: [],
      suggestedAdmissionDate: '',
      isSuspicious: false,
    };
  }

  const candidateDates = Array.from(
    new Set([getPreviousDay(baseDate), baseDate, getNextDay(baseDate)])
  );
  const suggestedAdmissionDate =
    resolveAdmissionDateSuggestion(baseDate, admissionTime) || baseDate;
  const normalizedAdmissionDate = normalizeDateOnly(admissionDate);
  const isSuspicious =
    normalizedAdmissionDate !== undefined && !candidateDates.includes(normalizedAdmissionDate);

  if (!isSuspicious) {
    return {
      baseDate,
      candidateDates,
      suggestedAdmissionDate,
      isSuspicious: false,
    };
  }

  const allowedDatesLabel = candidateDates.join(' / ');
  const message = firstSeenDate
    ? `La fecha no coincide con la primera aparición observada. Revisa ${allowedDatesLabel}.`
    : `La fecha no coincide con la ventana esperada para ingreso nuevo (${allowedDatesLabel}).`;

  return {
    baseDate,
    candidateDates,
    suggestedAdmissionDate,
    isSuspicious: true,
    message,
  };
};

export const resolveAdmissionDateWindowViolation = ({
  recordDate,
  path,
  patient,
}: {
  recordDate: string;
  path: string;
  patient?: AdmissionDateValidationPatient;
}): AdmissionDatePersistenceViolation | null => {
  if (!hasIdentity(patient) || !normalizeDateOnly(patient.firstSeenDate)) {
    return null;
  }

  const normalizedRecordDate = normalizeDateOnly(recordDate);
  const normalizedFirstSeenDate = normalizeDateOnly(patient.firstSeenDate);
  if (normalizedRecordDate !== normalizedFirstSeenDate) {
    return null;
  }

  const audit = resolveAdmissionDateAudit({
    recordDate,
    admissionDate: patient.admissionDate,
    admissionTime: patient.admissionTime,
    firstSeenDate: patient.firstSeenDate,
  });

  if (!audit.isSuspicious) {
    return null;
  }

  return {
    path,
    patientName: patient.patientName.trim(),
    rut: patient.rut.trim(),
    message: audit.message || 'La fecha de ingreso no coincide con la ventana permitida.',
    currentAdmissionDate: normalizeDateOnly(patient.admissionDate),
    attemptedAdmissionDate: normalizeDateOnly(patient.admissionDate),
    firstSeenDate: normalizeDateOnly(patient.firstSeenDate),
  };
};

export const resolveAdmissionDateMutationViolation = ({
  recordDate,
  path,
  currentPatient,
  nextPatient,
}: {
  recordDate: string;
  path: string;
  currentPatient?: AdmissionDateValidationPatient;
  nextPatient?: AdmissionDateValidationPatient;
}): AdmissionDatePersistenceViolation | null => {
  if (!hasIdentity(currentPatient) || !hasIdentity(nextPatient)) {
    return null;
  }

  const firstSeenDate = normalizeDateOnly(
    nextPatient.firstSeenDate || currentPatient.firstSeenDate
  );
  if (!firstSeenDate || normalizeDateOnly(recordDate) === firstSeenDate) {
    return null;
  }

  const currentAdmissionDate = normalizeDateOnly(currentPatient.admissionDate);
  const nextAdmissionDate = normalizeDateOnly(nextPatient.admissionDate);

  if (!currentAdmissionDate || !nextAdmissionDate || currentAdmissionDate === nextAdmissionDate) {
    return null;
  }

  return {
    path,
    patientName: nextPatient.patientName.trim(),
    rut: nextPatient.rut.trim(),
    message:
      'La fecha de ingreso solo puede modificarse durante el primer día observado del episodio.',
    currentAdmissionDate,
    attemptedAdmissionDate: nextAdmissionDate,
    firstSeenDate,
  };
};
