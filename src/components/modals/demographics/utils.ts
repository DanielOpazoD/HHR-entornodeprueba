import {
  DemographicSubset,
  LocalDemographicsState,
  DocumentType,
  Insurance,
  AdmissionOrigin,
  Origin,
  BiologicalSex,
} from './types';
import { PatientIdentityStatus } from '@/types/domain/patientIdentity';

export const normalizeNamePart = (value: string): string => value.trim().replace(/\s+/g, ' ');
const normalizeComparableName = (value: string): string => normalizeNamePart(value).toLowerCase();

export const composeFullName = (
  firstName: string,
  lastName: string,
  secondLastName: string
): string => [firstName, lastName, secondLastName].map(normalizeNamePart).filter(Boolean).join(' ');

export const splitFromLegacyName = (
  patientName: string
): { firstName: string; lastName: string; secondLastName: string } => {
  const normalized = normalizeNamePart(patientName);
  if (!normalized) {
    return { firstName: '', lastName: '', secondLastName: '' };
  }

  const parts = normalized.split(' ');
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '', secondLastName: '' };
  }
  if (parts.length === 2) {
    return { firstName: parts[0], lastName: parts[1], secondLastName: '' };
  }
  return {
    firstName: parts.slice(0, -2).join(' '),
    lastName: parts[parts.length - 2],
    secondLastName: parts[parts.length - 1],
  };
};

export const inferIdentityStatus = (
  data: DemographicSubset,
  isClinicalCribPatient: boolean
): PatientIdentityStatus => {
  if (data.identityStatus) {
    return data.identityStatus;
  }

  if (!isClinicalCribPatient) {
    return 'official';
  }

  const hasSplitName = Boolean(
    data.firstName?.trim() || data.lastName?.trim() || data.secondLastName?.trim()
  );
  const normalizedRut = (data.rut || '').trim();
  const hasOfficialRut = normalizedRut.length > 0 && normalizedRut !== '-';

  return hasSplitName || hasOfficialRut ? 'official' : 'provisional';
};

export const buildLocalData = (
  data: DemographicSubset,
  isClinicalCribPatient: boolean
): LocalDemographicsState => {
  const explicitFullName = composeFullName(
    data.firstName || '',
    data.lastName || '',
    data.secondLastName || ''
  );
  const hasExplicitNameParts = Boolean(explicitFullName);
  const hasMismatchedExplicitNameParts =
    hasExplicitNameParts &&
    normalizeComparableName(explicitFullName) !== normalizeComparableName(data.patientName || '');

  const initialNameParts =
    hasExplicitNameParts && !hasMismatchedExplicitNameParts
      ? {
          firstName: data.firstName || '',
          lastName: data.lastName || '',
          secondLastName: data.secondLastName || '',
        }
      : splitFromLegacyName(data.patientName || '');

  return {
    firstName: initialNameParts.firstName,
    lastName: initialNameParts.lastName,
    secondLastName: initialNameParts.secondLastName,
    provisionalName: normalizeNamePart(data.patientName || ''),
    identityStatus: inferIdentityStatus(data, isClinicalCribPatient),
    rut: data.rut || '',
    documentType: (data.documentType || 'RUT') as DocumentType,
    birthDate: data.birthDate || '',
    insurance: (data.insurance || 'Fonasa') as Insurance,
    admissionOrigin: (data.admissionOrigin || '') as AdmissionOrigin | '',
    admissionOriginDetails: data.admissionOriginDetails || '',
    origin: (data.origin || 'Residente') as Origin,
    isRapanui: data.isRapanui || false,
    biologicalSex: (data.biologicalSex || 'Indeterminado') as BiologicalSex,
    admissionDate: data.admissionDate || '',
    admissionTime: data.admissionTime || '',
    pathology: data.pathology || '',
  };
};

export const hasMeaningfulDemographicSubset = (data: DemographicSubset): boolean =>
  Boolean(
    normalizeNamePart(data.patientName || '') ||
    normalizeNamePart(data.firstName || '') ||
    normalizeNamePart(data.lastName || '') ||
    normalizeNamePart(data.secondLastName || '') ||
    (data.rut || '').trim() ||
    (data.birthDate || '').trim() ||
    (data.admissionOrigin || '').trim() ||
    normalizeNamePart(data.admissionOriginDetails || '') ||
    data.isRapanui ||
    (data.biologicalSex && data.biologicalSex !== 'Indeterminado') ||
    (data.insurance && data.insurance !== 'Fonasa') ||
    (data.origin && data.origin !== 'Residente') ||
    (data.documentType && data.documentType !== 'RUT') ||
    (data.admissionDate || '').trim() ||
    (data.admissionTime || '').trim() ||
    normalizeNamePart(data.pathology || '')
  );

export const hasMeaningfulLocalDemographics = (localData: LocalDemographicsState): boolean =>
  Boolean(
    normalizeNamePart(localData.provisionalName) ||
    normalizeNamePart(localData.firstName) ||
    normalizeNamePart(localData.lastName) ||
    normalizeNamePart(localData.secondLastName) ||
    localData.rut.trim() ||
    localData.birthDate.trim() ||
    localData.admissionOrigin ||
    normalizeNamePart(localData.admissionOriginDetails) ||
    localData.isRapanui ||
    localData.biologicalSex !== 'Indeterminado' ||
    localData.insurance !== 'Fonasa' ||
    localData.origin !== 'Residente' ||
    localData.documentType !== 'RUT' ||
    localData.admissionDate.trim() ||
    localData.admissionTime.trim() ||
    normalizeNamePart(localData.pathology)
  );

export interface DemographicsCompletionStatus {
  isComplete: boolean;
  missingFields: string[];
}

export const resolveRequiredDemographicsCompletion = (
  localData: LocalDemographicsState,
  isProvisionalRnMode: boolean
): DemographicsCompletionStatus => {
  const missingFields: string[] = [];

  if (isProvisionalRnMode) {
    if (!normalizeNamePart(localData.provisionalName)) {
      missingFields.push('nombre provisional');
    }
  } else {
    if (!normalizeNamePart(localData.firstName)) {
      missingFields.push('nombre');
    }
    if (!normalizeNamePart(localData.lastName)) {
      missingFields.push('apellido paterno');
    }
    if (!normalizeNamePart(localData.secondLastName)) {
      missingFields.push('apellido materno');
    }
    if (!localData.rut.trim()) {
      missingFields.push('documento');
    }
  }

  if (!localData.birthDate.trim()) {
    missingFields.push('fecha de nacimiento');
  }
  if (!localData.admissionDate.trim()) {
    missingFields.push('fecha de ingreso');
  }
  if (!localData.admissionTime.trim()) {
    missingFields.push('hora de ingreso');
  }
  if (!localData.admissionOrigin) {
    missingFields.push('procedencia');
  }
  if (
    localData.admissionOrigin === 'Otro' &&
    !normalizeNamePart(localData.admissionOriginDetails)
  ) {
    missingFields.push('detalle de procedencia');
  }
  if (localData.biologicalSex === 'Indeterminado') {
    missingFields.push('sexo');
  }

  return {
    isComplete: missingFields.length === 0,
    missingFields,
  };
};

export const calculateFormattedAge = (dob: string) => {
  if (!dob) return '';
  const birth = new Date(dob);
  const today = new Date();

  const diffTime = today.getTime() - birth.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return '';

  if (diffDays < 30) {
    return `${diffDays}d`;
  }

  let months =
    (today.getFullYear() - birth.getFullYear()) * 12 + (today.getMonth() - birth.getMonth());
  if (today.getDate() < birth.getDate()) {
    months--;
  }

  if (months <= 24) {
    return `${months}m`;
  }

  const years = Math.floor(months / 12);
  return `${years}a`;
};
