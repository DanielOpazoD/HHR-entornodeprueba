// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mapPatientToFhir } from '@/services/utils/fhirMappers';
import type { FhirResource } from '@/types/domain/fhir';
import type { PatientData } from '@/types/domain/patient';
import { Specialty, PatientStatus } from '@/types/domain/patientClassification';

// Local FHIR interfaces for convenience in testing
interface FhirPatient extends FhirResource {
  identifier?: Array<{ system: string; value: string; use?: string }>;
  name?: Array<{ text: string; family?: string; given?: string[]; use?: string }>;
  gender?: string;
  birthDate?: string;
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
    isUPC: false,
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

  it.each([
    ['Femenino', 'female'],
    ['Indeterminado', 'other'],
  ] as const)('maps biological sex %s to FHIR gender %s', (biologicalSex, gender) => {
    const fhirPatient = mapPatientToFhir({ ...mockPatient, biologicalSex }) as FhirPatient;
    expect(fhirPatient.gender).toBe(gender);
  });
});
