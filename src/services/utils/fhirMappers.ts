import type { PatientData } from '@/types/domain/patient';

/**
 * FHIR Mappers for HL7 FHIR Core-CL Compliance
 *
 * Provides utilities to transform HHR domain objects into national standard
 * FHIR resources (R4).
 */

import type { FhirResource } from '@/types/domain/fhir';

/**
 * Systems and Standard URIs for Chile (Core-CL)
 */
export const FHIR_SYSTEMS = {
  RUN: 'https://registrocivil.cl/run',
  DEIS: 'https://deis.minsal.cl/establecimiento',
  NATIONALITY: 'https://hl7chile.cl/fhir/ig/clcore/StructureDefinition/CodigoPaises',
  SURNAME: 'https://hl7chile.cl/fhir/ig/clcore/StructureDefinition/SegundoApellido',
  SNOMED: 'http://snomed.info/sct',
  CIE10: 'http://hl7.org/fhir/sid/icd-10',
};

export const FHIR_PROFILES = {
  PATIENT: 'https://hl7chile.cl/fhir/ig/clcore/StructureDefinition/CorePacienteCl',
  ORGANIZATION: 'https://hl7chile.cl/fhir/ig/clcore/StructureDefinition/CoreOrganizacionCl',
  ENCOUNTER: 'https://hl7chile.cl/fhir/ig/clcore/StructureDefinition/CoreEncuentroCl',
};

/**
 * Maps HHR PatientData to HL7 FHIR Core-CL Patient resource
 */
export function mapPatientToFhir(patient: PatientData): FhirResource {
  const names = patient.patientName.trim().split(/\s+/);
  const family = names.length > 1 ? names[names.length - 1] : names[0];
  const given = names.length > 1 ? names.slice(0, -1) : [];

  // Basic FHIR Patient structure
  const resource: FhirResource = {
    resourceType: 'Patient',
    id: patient.rut.replace(/[^a-zA-Z0-9]/g, '') || undefined,
    meta: {
      profile: [FHIR_PROFILES.PATIENT],
    },
    identifier: [
      {
        use: 'official',
        system: FHIR_SYSTEMS.RUN,
        value: patient.rut,
      },
    ],
    active: true,
    name: [
      {
        use: 'official',
        text: patient.patientName,
        family,
        given,
      },
    ],
    gender: mapGender(patient.biologicalSex),
    birthDate: patient.birthDate,
    extension: [],
  };

  // Add Rapanui extension if true
  if (patient.isRapanui) {
    resource.extension?.push({
      url: 'https://hl7chile.cl/fhir/ig/clcore/StructureDefinition/PertenecePueblosOriginarios',
      valueBoolean: true,
    });
  }

  return resource;
}

/**
 * Maps HHR biologicalSex to FHIR gender
 */
function mapGender(sex?: string): 'male' | 'female' | 'other' | 'unknown' {
  switch (sex) {
    case 'Masculino':
      return 'male';
    case 'Femenino':
      return 'female';
    case 'Indeterminado':
      return 'other';
    default:
      return 'unknown';
  }
}
