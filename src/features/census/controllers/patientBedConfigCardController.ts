import { calculateHospitalizedDays } from '@/features/census/controllers/patientBedConfigViewController';

export interface PatientBedIndicatorsParams {
  isCunaMode: boolean;
  hasCompanion: boolean;
  hasClinicalCrib: boolean;
}

export interface PatientBedIndicator {
  key: 'cuna';
  label: string;
  title?: string;
  className: string;
}

export const resolvePatientBedIndicators = ({
  isCunaMode,
  hasCompanion: _hasCompanion,
  hasClinicalCrib: _hasClinicalCrib,
}: PatientBedIndicatorsParams): PatientBedIndicator[] => {
  const indicators: PatientBedIndicator[] = [];

  if (isCunaMode) {
    indicators.push({
      key: 'cuna',
      label: 'CUNA',
      className:
        'text-[9px] bg-pink-100 text-pink-700 font-bold px-1 rounded-sm border border-pink-200',
    });
  }

  return indicators;
};

interface BuildPatientBedConfigCardStateParams {
  admissionDate?: string;
  currentDateString: string;
  patientName?: string;
  isBlocked: boolean;
  hasCompanion: boolean;
  hasClinicalCrib: boolean;
  isCunaMode: boolean;
  readOnly: boolean;
}

export const buildPatientBedConfigCardState = ({
  admissionDate,
  currentDateString,
  patientName,
  isBlocked,
  hasCompanion,
  hasClinicalCrib,
  isCunaMode,
  readOnly,
}: BuildPatientBedConfigCardStateParams) => {
  const daysHospitalized = calculateHospitalizedDays({
    admissionDate,
    currentDate: currentDateString,
  });
  const hasPatient = Boolean(patientName);
  const indicators = resolvePatientBedIndicators({
    isCunaMode,
    hasCompanion,
    hasClinicalCrib,
  });

  return {
    daysHospitalized,
    hasPatient,
    indicators,
    showDaysCounter: !isBlocked && hasPatient && daysHospitalized !== null,
    showIndicators: !isBlocked,
    showMenu: !isBlocked && !readOnly,
    showClinicalCribToggle: !isCunaMode,
    showClinicalCribActions: hasClinicalCrib,
    showLegacyCompanionCleanup: hasCompanion,
  };
};
