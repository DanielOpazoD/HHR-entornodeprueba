import type { PatientData } from '@/types/domain/patient';

import type { BedDefinition } from '@/types/domain/beds';
import type { BedType } from '@/types/domain/beds';

import type { UserRole } from '@/types/authRoleTypes';
import type { PatientActionMenuIndicators } from '@/features/census/components/patient-row/patientRowActionContracts';
import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowUiContracts';
import type {
  PatientMainRowBindings,
  PatientSubRowBindings,
  PatientRowModalsBindings,
  PatientRowBindings,
  PatientRowRuntime,
} from '@/features/census/components/patient-row/patientRowRuntimeContracts';
import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
import {
  buildPatientMainSectionBindings,
  buildPatientModalSectionBindings,
  buildPatientSubSectionBindings,
  type PatientRowViewContext,
} from '@/features/census/controllers/patientRowBindingSectionsController';
import { resolvePatientRowCapabilities } from '@/features/census/controllers/patientRowCapabilitiesController';
import {
  resolvePatientRowIndicators,
  type PatientRowResolvedIndicators,
} from '@/features/census/controllers/patientRowIndicatorsController';
import { canSetArbitraryAdmissionDate } from '@/shared/access/operationalAccessPolicy';

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

export interface BuildPatientRowBindingsParams {
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
  runtime: PatientRowRuntime;
}

export type PatientRowBindingsInput = Omit<BuildPatientRowBindingsParams, 'runtime'>;

const resolvePatientRowContextWithOverrides = ({
  role,
  data,
  runtime,
  indicators,
  accessProfile,
  capabilitiesOverride,
  resolvedIndicatorsOverride,
}: {
  role?: UserRole;
  data: PatientData;
  runtime: PatientRowRuntime;
  indicators?: PatientActionMenuIndicators;
  accessProfile?: CensusAccessProfile;
  capabilitiesOverride?: PatientRowViewContext['capabilities'];
  resolvedIndicatorsOverride?: PatientRowResolvedIndicators;
}): PatientRowViewContext => {
  const resolvedViewContext = resolvePatientRowViewContext({
    role,
    data,
    runtime,
    indicators,
    accessProfile,
  });

  return {
    capabilities: capabilitiesOverride ?? resolvedViewContext.capabilities,
    indicators: resolvedIndicatorsOverride ?? resolvedViewContext.indicators,
  };
};

export const buildPatientMainRowBindings = ({
  bed,
  bedType,
  data,
  currentDateString,
  readOnly,
  clinicalEditingDisabled = false,
  actionMenuAlign,
  role,
  indicators,
  accessProfile,
  style,
  capabilitiesOverride,
  resolvedIndicatorsOverride,
  runtime,
}: Pick<
  BuildPatientRowBindingsParams,
  | 'bed'
  | 'bedType'
  | 'data'
  | 'currentDateString'
  | 'readOnly'
  | 'clinicalEditingDisabled'
  | 'actionMenuAlign'
  | 'role'
  | 'accessProfile'
  | 'indicators'
  | 'style'
  | 'runtime'
> & {
  capabilitiesOverride?: PatientRowViewContext['capabilities'];
  resolvedIndicatorsOverride?: PatientRowResolvedIndicators;
}): PatientMainRowBindings => {
  const viewContext = resolvePatientRowContextWithOverrides({
    role,
    data,
    runtime,
    indicators,
    accessProfile,
    capabilitiesOverride,
    resolvedIndicatorsOverride,
  });
  return buildPatientMainSectionBindings({
    bed,
    bedType,
    data,
    currentDateString,
    readOnly,
    clinicalEditingDisabled,
    actionMenuAlign,
    accessProfile,
    style,
    runtime,
    viewContext,
  });
};

export const buildPatientSubRowBindings = ({
  data,
  currentDateString,
  readOnly,
  clinicalEditingDisabled = false,
  accessProfile,
  style,
  runtime,
}: Pick<
  BuildPatientRowBindingsParams,
  | 'data'
  | 'currentDateString'
  | 'readOnly'
  | 'clinicalEditingDisabled'
  | 'accessProfile'
  | 'style'
  | 'runtime'
>): PatientSubRowBindings =>
  buildPatientSubSectionBindings({
    data,
    currentDateString,
    readOnly,
    clinicalEditingDisabled,
    accessProfile,
    style,
    runtime,
  });

export const buildPatientRowModalsBindings = ({
  bed,
  data,
  currentDateString,
  isSubRow,
  role,
  accessProfile,
  capabilitiesOverride,
  runtime,
}: Pick<
  BuildPatientRowBindingsParams,
  'bed' | 'data' | 'currentDateString' | 'isSubRow' | 'role' | 'runtime'
> & {
  capabilitiesOverride?: PatientRowViewContext['capabilities'];
  accessProfile?: CensusAccessProfile;
}): PatientRowModalsBindings =>
  buildPatientModalSectionBindings({
    bedId: bed.id,
    data,
    currentDateString,
    isSubRow,
    canUseArbitraryAdmissionDate: canSetArbitraryAdmissionDate(role),
    runtime,
    viewContext: resolvePatientRowContextWithOverrides({
      role,
      data,
      runtime,
      accessProfile,
      capabilitiesOverride,
    }),
  });

export const buildPatientRowBindings = ({
  bed,
  bedType,
  data,
  currentDateString,
  readOnly,
  clinicalEditingDisabled = false,
  actionMenuAlign,
  isSubRow,
  role,
  accessProfile,
  indicators,
  style,
  runtime,
}: BuildPatientRowBindingsParams): PatientRowBindings => {
  const viewContext = resolvePatientRowViewContext({
    role,
    data,
    runtime,
    indicators,
    accessProfile,
  });

  return {
    mainRowProps: buildPatientMainRowBindings({
      bed,
      bedType,
      data,
      currentDateString,
      readOnly,
      clinicalEditingDisabled,
      actionMenuAlign,
      role,
      accessProfile,
      indicators,
      style,
      capabilitiesOverride: viewContext.capabilities,
      resolvedIndicatorsOverride: viewContext.indicators,
      runtime,
    }),
    subRowProps: buildPatientSubRowBindings({
      data,
      currentDateString,
      readOnly,
      clinicalEditingDisabled,
      accessProfile,
      style,
      runtime,
    }),
    modalsProps: buildPatientRowModalsBindings({
      bed,
      data,
      currentDateString,
      isSubRow,
      role,
      accessProfile,
      capabilitiesOverride: viewContext.capabilities,
      runtime,
    }),
  };
};
