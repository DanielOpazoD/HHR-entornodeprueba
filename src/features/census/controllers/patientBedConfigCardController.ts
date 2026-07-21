import {
  resolveBedModeButtonModel,
  resolveClinicalCribButtonModel,
  resolvePatientBedIndicators,
} from '@/features/census/controllers/patientBedConfigMenuController';
import { calculateHospitalizedDays } from '@/features/census/controllers/patientBedConfigViewController';

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
  const bedModeModel = resolveBedModeButtonModel(isCunaMode);
  const clinicalCribModel = resolveClinicalCribButtonModel(hasClinicalCrib);

  return {
    daysHospitalized,
    hasPatient,
    indicators,
    bedModeModel,
    clinicalCribModel,
    showDaysCounter: !isBlocked && hasPatient && daysHospitalized !== null,
    showIndicators: !isBlocked,
    showMenu: !isBlocked && !readOnly,
    showClinicalCribToggle: !isCunaMode,
    showClinicalCribActions: hasClinicalCrib,
    showLegacyCompanionCleanup: hasCompanion,
  };
};
