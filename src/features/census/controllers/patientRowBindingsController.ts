import type { PatientData } from '@/types/domain/patient';
import type { BedDefinition, BedType } from '@/types/domain/beds';
import type { UserRole } from '@/types/authRoleTypes';
import type { PatientActionMenuIndicators } from '@/features/census/components/patient-row/patientRowActionContracts';
import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowUiContracts';
import type {
  PatientRowBindings,
  PatientRowRuntime,
} from '@/features/census/components/patient-row/patientRowRuntimeContracts';
import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
import {
  buildPatientMainSectionBindings,
  buildPatientModalSectionBindings,
  buildPatientSubSectionBindings,
} from '@/features/census/controllers/patientRowBindingSectionsController';
import { resolvePatientRowCapabilities } from '@/features/census/controllers/patientRowCapabilitiesController';
import { resolvePatientRowIndicators } from '@/features/census/controllers/patientRowIndicatorsController';
import { canSetArbitraryAdmissionDate } from '@/shared/access/operationalAccessPolicy';

export interface PatientRowBindingsInput {
  bed: BedDefinition;
  bedType: BedType;
  data: PatientData;
  currentDateString: string;
  readOnly: boolean;
  clinicalEditingDisabled?: boolean;
  actionMenuAlign: RowMenuAlign;
  isSubRow: boolean;
  role?: UserRole;
  accessProfile?: CensusAccessProfile;
  indicators?: PatientActionMenuIndicators;
  style?: React.CSSProperties;
}

export const buildPatientRowBindings = (
  input: PatientRowBindingsInput & { runtime: PatientRowRuntime }
): PatientRowBindings => {
  const { data, role, runtime, accessProfile } = input;
  const capabilities = resolvePatientRowCapabilities({
    role,
    patient: data,
    isBlocked: runtime.rowState.isBlocked,
    isEmpty: runtime.rowState.isEmpty,
    accessProfile,
  });

  return {
    mainRowProps: buildPatientMainSectionBindings({
      ...input,
      capabilities,
      indicators: resolvePatientRowIndicators({
        indicators: input.indicators,
        canShowClinicalDocumentIndicator: capabilities.canShowClinicalDocumentIndicator,
      }),
    }),
    subRowProps: buildPatientSubSectionBindings(input),
    modalsProps: buildPatientModalSectionBindings({
      bedId: input.bed.id,
      data,
      currentDateString: input.currentDateString,
      isSubRow: input.isSubRow,
      canUseArbitraryAdmissionDate: canSetArbitraryAdmissionDate(role),
      runtime,
      capabilities,
    }),
  };
};
