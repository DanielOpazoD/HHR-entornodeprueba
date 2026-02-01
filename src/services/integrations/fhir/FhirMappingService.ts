/**
 * FHIR Mapping Service
 * 
 * Maps internal DailyRecord and PatientData structures to HL7 FHIR R4 resources.
 * This is a requirement for MINSAL interoperability (CENS / SIDRA).
 */

import { PatientData, DailyRecord } from '@/types';

/**
 * Minimal FHIR Patient Resource
 */
export interface FhirPatient {
    resourceType: 'Patient';
    id: string;
    identifier: Array<{
        use?: 'official' | 'usual' | 'secondary';
        system: string; // e.g. "https://registrocivil.cl/rut"
        value: string;
    }>;
    name: Array<{
        text: string;
        family?: string;
        given?: string[];
    }>;
    gender?: 'male' | 'female' | 'other' | 'unknown';
    birthDate?: string;
}

/**
 * Minimal FHIR Encounter Resource
 */
export interface FhirEncounter {
    resourceType: 'Encounter';
    id: string;
    status: 'in-progress' | 'finished' | 'cancelled' | 'onleave';
    class: {
        system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode';
        code: 'IMP'; // Inpatient
        display: 'inpatient encounter';
    };
    subject: {
        reference: string;
    };
    period: {
        start?: string;
        end?: string;
    };
    reasonCode?: Array<{
        text: string;
    }>;
}

/**
 * Maps our internal PatientData to a FHIR Patient resource
 */
export const mapToFhirPatient = (patient: PatientData): FhirPatient => {
    // Basic identifier mapping (RUT)
    const identifiers: FhirPatient['identifier'] = [];
    if (patient.rut) {
        identifiers.push({
            system: patient.documentType === 'Pasaporte'
                ? 'urn:oid:2.16.840.1.113883.2.10.61' // Example for passports
                : 'https://registrocivil.cl/rut',
            value: patient.rut,
            use: 'official'
        });
    }

    // Name mapping
    const nameData: FhirPatient['name'][0] = {
        text: patient.patientName
    };

    // Attempt to split simple names if possible (conservative)
    const nameParts = patient.patientName.trim().split(/\s+/);
    if (nameParts.length >= 2) {
        nameData.family = nameParts.slice(-1)[0];
        nameData.given = nameParts.slice(0, -1);
    }

    // Gender mapping
    let gender: FhirPatient['gender'] = 'unknown';
    if (patient.biologicalSex === 'Masculino') gender = 'male';
    else if (patient.biologicalSex === 'Femenino') gender = 'female';
    else if (patient.biologicalSex === 'Indeterminado') gender = 'other';

    return {
        resourceType: 'Patient',
        id: `p-${patient.rut.replace(/[^a-zA-Z0-9]/g, '') || Math.random().toString(36).substr(2, 9)}`,
        identifier: identifiers,
        name: [nameData],
        gender,
        birthDate: patient.birthDate || undefined
    };
};

/**
 * Maps our internal PatientData and record date to a FHIR Encounter resource
 */
export const mapToFhirEncounter = (patient: PatientData, recordDate: string, patientRef: string): FhirEncounter => {
    return {
        resourceType: 'Encounter',
        id: `enc-${recordDate}-${patient.bedId}`,
        status: 'in-progress',
        class: {
            system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
            code: 'IMP',
            display: 'inpatient encounter'
        },
        subject: {
            reference: `Patient/${patientRef}`
        },
        period: {
            start: patient.admissionDate ? new Date(patient.admissionDate).toISOString() : undefined
        },
        reasonCode: [
            { text: patient.pathology }
        ]
    };
};

/**
 * Maps an entire DailyRecord to a FHIR Bundle (collection of resources)
 */
export const mapRecordToFhirBundle = (record: DailyRecord) => {
    const entries = Object.values(record.beds)
        .filter(p => p.patientName && p.patientName !== 'Bloqueada')
        .flatMap(patient => {
            const fhirPatient = mapToFhirPatient(patient);
            const fhirEncounter = mapToFhirEncounter(patient, record.date, fhirPatient.id);

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
};

/**
 * Maps a single PatientData to a FHIR Bundle
 */
export const mapPatientToFhirBundle = (patient: PatientData, recordDate: string) => {
    const fhirPatient = mapToFhirPatient(patient);
    const fhirEncounter = mapToFhirEncounter(patient, recordDate, fhirPatient.id);

    return {
        resourceType: 'Bundle',
        type: 'collection',
        timestamp: new Date().toISOString(),
        entry: [
            {
                fullUrl: `urn:uuid:${fhirPatient.id}`,
                resource: fhirPatient
            },
            {
                fullUrl: `urn:uuid:${fhirEncounter.id}`,
                resource: fhirEncounter
            }
        ]
    };
};
