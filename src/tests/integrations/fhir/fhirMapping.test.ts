import { describe, it, expect } from 'vitest';
import { mapPatientToFhir, mapEncounterToFhir, mapRecordToFhirBundle, mapMasterPatientToFhir } from '@/services/utils/fhirMappers';
import { PatientData, Specialty, PatientStatus, DailyRecord, FhirResource } from '@/types';

// Local FHIR interfaces for convenience in testing
interface FhirPatient extends FhirResource {
    identifier?: Array<{ system: string; value: string; use?: string }>;
    name?: Array<{ text: string; family?: string; given?: string[]; use?: string }>;
    gender?: string;
    birthDate?: string;
}

interface FhirEncounter extends FhirResource {
    status?: string;
    class: { code: string; system?: string; display?: string };
    subject: { identifier: { value: string; system?: string } };
}

interface FhirBundle extends FhirResource {
    type: string;
    entry?: Array<{ fullUrl: string; resource: FhirResource }>;
}

describe('FhirMappingService', () => {
    const mockPatient: PatientData = {
        bedId: 'bed-1',
        isBlocked: false,
        bedMode: 'Cama',
        hasCompanionCrib: false,
        patientName: 'JUAN PEREZ SOTO',
        rut: '12.345.678-9',
        documentType: 'RUT',
        age: '45',
        biologicalSex: 'Masculino',
        pathology: 'Neumonía',
        specialty: Specialty.MEDICINA,
        status: PatientStatus.ESTABLE,
        admissionDate: '2023-12-01',
        hasWristband: true,
        devices: [],
        surgicalComplication: false,
        isUPC: false
    };

    it('should map a patient to FHIR Patient resource', () => {
        const fhirPatient = mapPatientToFhir(mockPatient) as FhirPatient;

        expect(fhirPatient.resourceType).toBe('Patient');
        expect(fhirPatient.identifier![0].value).toBe('12.345.678-9');
        expect(fhirPatient.identifier![0].system).toBe('https://registrocivil.cl/run');
        expect(fhirPatient.name![0].text).toBe('JUAN PEREZ SOTO');
        expect(fhirPatient.gender).toBe('male');
    });

    it('should map specific name fields (family and given)', () => {
        const fhirPatient = mapPatientToFhir(mockPatient) as FhirPatient;
        expect(fhirPatient.name![0].family).toBe('SOTO');
        expect(fhirPatient.name![0].given).toContain('JUAN');
        expect(fhirPatient.name![0].given).toContain('PEREZ');
    });

    it('should map patient to FHIR Encounter resource', () => {
        const fhirEncounter = mapEncounterToFhir(mockPatient, 'hanga_roa') as FhirEncounter;

        expect(fhirEncounter.resourceType).toBe('Encounter');
        expect(fhirEncounter.status).toBe('in-progress');
        expect(fhirEncounter.class.code).toBe('IMP');
        expect(fhirEncounter.subject.identifier.value).toBe('12.345.678-9');
    });

    it('should map a MasterPatient to FHIR Patient resource', () => {
        const mockMaster = {
            rut: '98.765.432-1',
            fullName: 'MARIA PAZ TORRES',
            birthDate: '1990-05-20',
            gender: 'Femenino'
        };

        const fhirPatient = mapMasterPatientToFhir(mockMaster) as FhirPatient;
        expect(fhirPatient.resourceType).toBe('Patient');
        expect(fhirPatient.identifier![0].value).toBe('98.765.432-1');
        expect(fhirPatient.name![0].family).toBe('TORRES');
        expect(fhirPatient.name![0].given).toContain('MARIA');
        expect(fhirPatient.gender).toBe('female');
        expect(fhirPatient.birthDate).toBe('1990-05-20');
    });

    it('should create a FHIR Bundle from a DailyRecord', () => {
        const mockRecord: DailyRecord = {
            date: '2023-12-28',
            beds: { 'bed-1': mockPatient },
            discharges: [],
            transfers: [],
            cma: [],
            lastUpdated: new Date().toISOString(),
            nurses: [],
            activeExtraBeds: []
        };

        const bundle = mapRecordToFhirBundle(mockRecord) as FhirBundle;
        expect(bundle.resourceType).toBe('Bundle');
        expect(bundle.type).toBe('transaction');
        expect(bundle.entry).toBeDefined();
        // Since entries are mapped as [Patient, Encounter], we expect 2
        expect(bundle.entry!.length).toBe(2);
    });
});
