import type { UserRole } from '@/types/authRoleTypes';
import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
import {
  canOpenClinicalDocumentsFromCensus,
  canViewPatientHistoryFromRestrictedProfiles,
} from '@/shared/access/operationalAccessPolicy';

interface ResolvePatientRowCapabilitiesParams {
  role?: UserRole;
  patient: {
    patientName?: string;
    rut?: string;
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

const resolvePatientIdentityFlags = (patient: ResolvePatientRowCapabilitiesParams['patient']) => ({
  hasPatientName: Boolean(patient?.patientName?.trim()),
  hasRut: Boolean(patient?.rut?.trim()),
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
