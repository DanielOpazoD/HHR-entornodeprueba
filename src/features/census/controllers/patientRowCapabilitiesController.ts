import type { UserRole } from '@/types/authRoleTypes';
import type { PatientIdentityReview } from '@/types/domain/patientIdentity';
import type { CensusAccessProfile } from '@/features/census/types/censusAccessProfile';
import {
  canOpenClinicalDocumentsFromCensus,
  canViewPatientHistoryFromRestrictedProfiles,
} from '@/shared/access/operationalAccessPolicy';

interface ResolvePatientRowCapabilitiesParams {
  role?: UserRole;
  patient: {
    patientName?: string;
    rut?: string;
    identityReview?: PatientIdentityReview;
  } | null;
  isBlocked: boolean;
  isEmpty: boolean;
  accessProfile?: CensusAccessProfile;
}

export interface PatientRowCapabilities {
  canOpenClinicalDocuments: boolean;
  canOpenExamRequest: boolean;
  canOpenImagingRequest: boolean;
  canOpenHistory: boolean;
  canShowClinicalDocumentIndicator: boolean;
}

// Documents, requests and history are found or filled by name and RUT: an identity under review
// would reach another patient's.
const resolvePatientIdentityFlags = (patient: ResolvePatientRowCapabilitiesParams['patient']) => ({
  hasPatientName: Boolean(patient?.patientName?.trim() && !patient.identityReview),
  hasRut: Boolean(patient?.rut?.trim() && !patient.identityReview),
});

export const resolvePatientRowCapabilities = ({
  role,
  patient,
  isBlocked,
  isEmpty,
  accessProfile = 'default',
}: ResolvePatientRowCapabilitiesParams): PatientRowCapabilities => {
  const { hasPatientName, hasRut } = resolvePatientIdentityFlags(patient);
  const canReadClinical = canOpenClinicalDocumentsFromCensus({
    role,
    isBlocked,
    isEmpty,
    hasPatientName,
  });

  return {
    canOpenClinicalDocuments: canReadClinical,
    canOpenExamRequest: hasPatientName,
    canOpenImagingRequest: hasPatientName,
    canOpenHistory: canViewPatientHistoryFromRestrictedProfiles({
      accessProfile,
      hasRut,
    }),
    canShowClinicalDocumentIndicator: canReadClinical,
  };
};
