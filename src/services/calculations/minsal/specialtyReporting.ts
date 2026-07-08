import { Specialty } from '@/types/domain/patientClassification';
import type {
  MinsalCalculationOptions,
  MinsalMovementKind,
  PatientTraceability,
} from '@/types/minsalTypes';
import { normalizeSpecialty } from './normalization';

const KNOWN_REPORTING_SPECIALTIES = new Set<string>(
  Object.values(Specialty)
    .filter(Boolean)
    .map(value => String(value))
);

interface ResolveReportingSpecialtyInput {
  specialty?: string;
  movementKind?: MinsalMovementKind;
  movementId?: string;
  date?: string;
  options?: MinsalCalculationOptions;
}

interface ReportingSpecialtyResolution {
  originalSpecialty: string;
  reportingSpecialty: string;
  reportingSpecialtySource: PatientTraceability['reportingSpecialtySource'];
}

const findManualReclassification = ({
  movementKind,
  movementId,
  date,
  options,
}: ResolveReportingSpecialtyInput) => {
  if (!movementKind || !movementId) {
    return undefined;
  }

  return options?.specialtyReclassifications?.find(item => {
    if (item.movementKind !== movementKind || item.movementId !== movementId) {
      return false;
    }
    return !item.date || !date || item.date === date;
  });
};

const groupIfNeeded = (
  specialty: string,
  options: MinsalCalculationOptions | undefined
): Pick<ReportingSpecialtyResolution, 'reportingSpecialty' | 'reportingSpecialtySource'> => {
  if (
    options?.specialtyGroupingMode === 'group-other' &&
    specialty !== 'Sin Especialidad' &&
    !KNOWN_REPORTING_SPECIALTIES.has(specialty)
  ) {
    return {
      reportingSpecialty: Specialty.OTRO,
      reportingSpecialtySource: 'grouped',
    };
  }

  return {
    reportingSpecialty: specialty,
    reportingSpecialtySource: 'original',
  };
};

export const resolveReportingSpecialty = (
  input: ResolveReportingSpecialtyInput
): ReportingSpecialtyResolution => {
  const originalSpecialty = normalizeSpecialty(input.specialty);
  const manual = findManualReclassification(input);

  if (manual) {
    return {
      originalSpecialty,
      reportingSpecialty: normalizeSpecialty(String(manual.specialty)),
      reportingSpecialtySource: 'manual',
    };
  }

  return {
    originalSpecialty,
    ...groupIfNeeded(originalSpecialty, input.options),
  };
};

export const buildReportingSpecialtyTraceFields = (
  resolution: ReportingSpecialtyResolution
): Pick<
  PatientTraceability,
  'originalSpecialty' | 'reportingSpecialty' | 'reportingSpecialtySource'
> => ({
  originalSpecialty: resolution.originalSpecialty,
  reportingSpecialty: resolution.reportingSpecialty,
  reportingSpecialtySource: resolution.reportingSpecialtySource,
});
