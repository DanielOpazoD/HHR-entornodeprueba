import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';
import { formatCensusPatientName } from '@/utils/patientNameDisplayUtils';

export interface ResolveNameInputStateParams {
  data: PatientData;
  isSubRow?: boolean;
  isEmpty?: boolean;
  readOnly?: boolean;
}

export interface NameInputState {
  fullName: string;
  canEditInlineName: boolean;
}

const normalizeNamePart = (value: string): string => value.trim().replace(/\s+/g, ' ');
const normalizeComparableName = (value: string): string => normalizeNamePart(value).toLowerCase();

const resolveFullName = (data: PatientData, preferLegacyName = false): string => {
  const firstName = data.firstName || '';
  const lastName = data.lastName || '';
  const secondLastName = data.secondLastName || '';
  const hasSplitFields = Boolean(firstName.trim() || lastName.trim() || secondLastName.trim());
  const fullNameFromParts = [firstName, lastName, secondLastName]
    .map(normalizeNamePart)
    .filter(Boolean)
    .join(' ');
  const legacyName = normalizeNamePart(data.patientName || '');

  if (
    !preferLegacyName &&
    hasSplitFields &&
    normalizeComparableName(fullNameFromParts) === normalizeComparableName(legacyName)
  ) {
    return fullNameFromParts;
  }

  if (!preferLegacyName && hasSplitFields && !legacyName) {
    return fullNameFromParts;
  }

  return legacyName;
};

const isOfficialIdentity = (data: PatientData): boolean => {
  if (data.identityStatus) {
    return data.identityStatus === 'official';
  }

  const hasNameParts = Boolean(
    data.firstName?.trim() || data.lastName?.trim() || data.secondLastName?.trim()
  );
  const normalizedRut = (data.rut || '').trim();
  const hasOfficialRut = normalizedRut.length > 0 && normalizedRut !== '-';
  return hasNameParts && hasOfficialRut;
};

export const resolveNameInputState = ({
  data,
  isSubRow = false,
  isEmpty = false,
  readOnly = false,
}: ResolveNameInputStateParams): NameInputState => {
  const isProvisionalClinicalCrib = isSubRow && !isOfficialIdentity(data);
  const canEditInlineName = !readOnly && !isEmpty && isProvisionalClinicalCrib;

  return {
    fullName: formatCensusPatientName(resolveFullName(data, isProvisionalClinicalCrib)),
    canEditInlineName,
  };
};
