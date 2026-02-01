/**
 * FHIR Interoperability Service (Prototype)
 * 
 * This service provides mapping logic to convert internal Patient and Record data
 * to the HL7 FHIR R4 Core-CL standard (Chilean Core).
 * 
 * Requirement: Ley 20.584 - Interoperability of Clinical Records.
 */

import { PatientData } from '@/types';

export interface FhirPatient {
    resourceType: 'Patient';
    id: string;
    identifier: Array<{
        system: string;
        value: string;
    }>;
    name: Array<{
        text: string;
    }>;
    gender: 'male' | 'female' | 'other' | 'unknown';
    birthDate?: string;
    extension?: Array<{
        url: string;
        valueBoolean?: boolean;
    }>;
}

/**
 * Maps internal PatientData to HL7 FHIR Patient Resource (Chilean profile draft)
 */
export const mapToFhirPatient = (data: PatientData, bedId: string): FhirPatient => {
    // Map gender to FHIR compliant values
    let gender: FhirPatient['gender'] = 'unknown';
    if (data.biologicalSex === 'Masculino') gender = 'male';
    else if (data.biologicalSex === 'Femenino') gender = 'female';
    else if (data.biologicalSex === 'Indeterminado') gender = 'other';

    return {
        resourceType: 'Patient',
        id: `hhr-patient-${bedId}`,
        identifier: data.rut ? [
            {
                system: 'https://registrocivil.cl/run',
                value: data.rut
            }
        ] : [],
        name: [
            {
                text: data.patientName || 'ANONYMOUS'
            }
        ],
        gender,
        birthDate: data.birthDate || undefined,
        extension: data.isRapanui ? [
            {
                url: 'https://minsal.cl/fhir/StructureDefinition/PertenenciaEtniace',
                valueBoolean: true
            }
        ] : []
    };
};

/**
 * Export a record as a FHIR Bundle
 */
export const exportAsFhirBundle = (beds: Record<string, PatientData>) => {
    const entries = Object.entries(beds)
        .filter(([_, data]) => data.patientName)
        .map(([bedId, data]) => ({
            fullUrl: `urn:uuid:${bedId}`,
            resource: mapToFhirPatient(data, bedId)
        }));

    return {
        resourceType: 'Bundle',
        type: 'collection',
        timestamp: new Date().toISOString(),
        entry: entries
    };
};
