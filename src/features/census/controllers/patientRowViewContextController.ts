import type { PatientData } from '@/types/domain/patient';

import type { PatientActionMenuIndicators } from '@/features/census/components/patient-row/patientRowActionContracts';
import type { PatientRowViewContext } from '@/features/census/controllers/patientRowBindingSectionsController';
import { resolvePatientRowCapabilities } from '@/features/census/controllers/patientRowCapabilitiesController';
import { resolvePatientRowIndicators } from '@/features/census/controllers/patientRowIndicatorsController';

import type { UserRole } from '@/types/authRoleTypes';
import type { PatientRowRuntime } from '@/features/census/components/patient-row/patientRowRuntimeContracts';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';

interface PatientRowViewContextInput {
  role?: UserRole;
  data: PatientData;
  runtime: PatientRowRuntime;
  indicators?: PatientActionMenuIndicators;
  accessProfile?: CensusAccessProfile;
}

export const resolvePatientRowViewContext = ({
  role,
  data,
  runtime,
  indicators,
  accessProfile = 'default',
}: PatientRowViewContextInput): PatientRowViewContext => {
  const capabilities = resolvePatientRowCapabilities({
    role,
    patient: data,
    isBlocked: runtime.rowState.isBlocked,
    isEmpty: runtime.rowState.isEmpty,
    accessProfile,
  });

  return {
    capabilities,
    indicators: resolvePatientRowIndicators({
      indicators,
      canShowClinicalDocumentIndicator: capabilities.canShowClinicalDocumentIndicator,
    }),
  };
};
