/**
 * FHIR Mappers for HL7 FHIR Core-CL Compliance
 * 
 * Provides utilities to transform HHR domain objects into national standard
 * FHIR resources (R4).
 */

import { PatientData, FhirResource } from '@/types';

/**
 * Systems and Standard URIs for Chile (Core-CL)
 */
export const FHIR_SYSTEMS = {
    RUN: 'https://registrocivil.cl/run',
    DEIS: 'https://deis.minsal.cl/establecimiento',
    NATIONALITY: 'https://hl7chile.cl/fhir/ig/clcore/StructureDefinition/CodigoPaises',
    SURNAME: 'https://hl7chile.cl/fhir/ig/clcore/StructureDefinition/SegundoApellido',
    SNOMED: 'http://snomed.info/sct',
    CIE10: 'http://hl7.org/fhir/sid/icd-10'
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
            profile: [FHIR_PROFILES.PATIENT]
        },
        identifier: [
            {
                use: 'official',
                system: FHIR_SYSTEMS.RUN,
                value: patient.rut
            }
        ],
        active: true,
        name: [
            {
                use: 'official',
                text: patient.patientName,
                family,
                given
            }
        ],
        gender: mapGender(patient.biologicalSex),
        birthDate: patient.birthDate,
        extension: []
    };

    // Add Rapanui extension if true
    if (patient.isRapanui) {
        resource.extension?.push({
            url: 'https://hl7chile.cl/fhir/ig/clcore/StructureDefinition/PertenecePueblosOriginarios',
            valueBoolean: true
        });
    }

    return resource;
}

/**
 * Maps HHR MasterPatient to HL7 FHIR Core-CL Patient resource
 */
export function mapMasterPatientToFhir(patient: { rut: string; fullName: string; birthDate?: string; gender?: string }): FhirResource {
    const names = patient.fullName.trim().split(/\s+/);
    const family = names.length > 1 ? names[names.length - 1] : names[0];
    const given = names.length > 1 ? names.slice(0, -1) : [];

    return {
        resourceType: 'Patient',
        id: patient.rut.replace(/[^a-zA-Z0-9]/g, ''),
        meta: {
            profile: [FHIR_PROFILES.PATIENT]
        },
        identifier: [
            {
                use: 'official',
                system: FHIR_SYSTEMS.RUN,
                value: patient.rut
            }
        ],
        active: true,
        name: [
            {
                use: 'official',
                text: patient.fullName,
                family,
                given
            }
        ],
        gender: mapGender(patient.gender),
        birthDate: patient.birthDate
    };
}

/**
 * Maps HHR biologicalSex to FHIR gender
 */
function mapGender(sex?: string): 'male' | 'female' | 'other' | 'unknown' {
    switch (sex) {
        case 'Masculino': return 'male';
        case 'Femenino': return 'female';
        case 'Indeterminado': return 'other';
        default: return 'unknown';
    }
}

/**
 * Maps HHR PatientData stay to a FHIR Encounter
 */
export function mapEncounterToFhir(patient: PatientData, hospitalId: string): FhirResource {
    return {
        resourceType: 'Encounter',
        meta: {
            profile: [FHIR_PROFILES.ENCOUNTER]
        },
        status: 'in-progress',
        class: {
            system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
            code: 'IMP',
            display: 'inpatient encounter'
        },
        subject: {
            identifier: {
                system: FHIR_SYSTEMS.RUN,
                value: patient.rut
            }
        },
        period: {
            start: patient.admissionDate
        },
        serviceProvider: {
            identifier: {
                system: FHIR_SYSTEMS.DEIS,
                value: hospitalId
            }
        },
        diagnosis: [
            {
                condition: {
                    display: patient.pathology,
                },
                use: {
                    coding: [
                        {
                            system: 'http://terminology.hl7.org/CodeSystem/diagnosis-role',
                            code: 'AD',
                            display: 'Admission diagnosis'
                        }
                    ]
                }
            }
        ],
        extension: patient.snomedCode ? [
            {
                url: 'https://hl7chile.cl/fhir/ig/clcore/StructureDefinition/CodigoDiagnostico',
                valueCodeableConcept: {
                    coding: [
                        {
                            system: FHIR_SYSTEMS.SNOMED,
                            code: patient.snomedCode,
                            display: patient.pathology
                        },
                        ...(patient.cie10Code ? [{
                            system: FHIR_SYSTEMS.CIE10,
                            code: patient.cie10Code
                        }] : [])
                    ]
                }
            }
        ] : []
    };
}

/**
 * Maps an entire DailyRecord to a FHIR Bundle (collection of resources)
 */
export function mapRecordToFhirBundle(record: { date: string; beds: Record<string, PatientData> }): FhirResource {
    const entries = Object.values(record.beds)
        .filter(p => p.patientName && p.patientName.trim())
        .flatMap(patient => {
            const fhirPatient = mapPatientToFhir(patient);
            const fhirEncounter = mapEncounterToFhir(patient, 'hanga_roa');

            return [
                {
                    fullUrl: `urn:uuid:${fhirPatient.id}`,
                    resource: fhirPatient
                },
                {
                    fullUrl: `urn:uuid:${fhirEncounter.id}`,
                    resource: fhirEncounter
                }
            ];
        });

    return {
        resourceType: 'Bundle',
        type: 'transaction',
        timestamp: new Date().toISOString(),
        entry: entries
    };
}
