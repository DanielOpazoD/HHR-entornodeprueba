import { describe, expect, it } from 'vitest';
import {
  ageFromBirthDate,
  formatRun,
  mapBiologicalSex,
  cleanDiagnosis,
  rayenToPatientData,
  toTitleCaseName,
  type RayenEncounter,
} from '@/features/rayen-import';

const REFERENCE = new Date(2026, 6, 8); // 2026-07-08 local

const baseEncounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: '141119',
  run: '144700554',
  firstGivenName: 'Carina Aranceli',
  firstFamilyName: 'Pate',
  secondFamilyName: 'Lillo',
  birthDate: '1974-05-18T00:00:00',
  administrativeSex: 'Mujer',
  gender: 'Femenina',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H1',
  bed: 'C2',
  admissionDatetime: '2026-07-08T14:19:46-06:00',
  diagnosis:
    'Problemas relacionados con otras circunstancias legales (Ingreso) (solicitud hospitalización)',
  ...overrides,
});

describe('helpers', () => {
  it('formatRun formats a raw RUN with dots and dash', () => {
    expect(formatRun('144700554')).toBe('14.470.055-4');
    expect(formatRun('12345678K')).toBe('12.345.678-K');
  });

  it('ageFromBirthDate computes whole years against a reference', () => {
    expect(ageFromBirthDate('1974-05-18T00:00:00', REFERENCE)).toBe('52');
    expect(ageFromBirthDate('1974-12-01', REFERENCE)).toBe('51'); // birthday not yet reached
    expect(ageFromBirthDate(undefined, REFERENCE)).toBe('');
  });

  it('mapBiologicalSex maps administrative sex / gender text', () => {
    expect(mapBiologicalSex('Mujer', 'Femenina')).toBe('Femenino');
    expect(mapBiologicalSex('Hombre', 'Masculino')).toBe('Masculino');
    expect(mapBiologicalSex(undefined, undefined)).toBe('Indeterminado');
  });

  it('cleanDiagnosis strips Rayen suffixes', () => {
    expect(cleanDiagnosis('Pielonefritis Aguda (Ingreso) (solicitud hospitalización)')).toBe(
      'Pielonefritis Aguda'
    );
  });

  it('toTitleCaseName capitalizes each word regardless of input casing', () => {
    expect(toTitleCaseName('JUAN PÉREZ')).toBe('Juan Pérez');
    expect(toTitleCaseName('maría-josé del pino')).toBe('María-José Del Pino');
    expect(toTitleCaseName(undefined)).toBe('');
  });
});

describe('rayenToPatientData', () => {
  it('maps a real-service encounter to PatientData with split names and formatted RUN', () => {
    const { patient, isCma, bedId } = rayenToPatientData(baseEncounter(), REFERENCE);
    expect(bedId).toBe('H1C2');
    expect(isCma).toBe(false);
    expect(patient.bedId).toBe('H1C2');
    expect(patient.clinicalEpisodeId).toBe('141119');
    expect(patient.rut).toBe('14.470.055-4');
    expect(patient.patientName).toBe('Carina Aranceli Pate Lillo');
    expect(patient.firstName).toBe('Carina Aranceli');
    expect(patient.lastName).toBe('Pate');
    expect(patient.secondLastName).toBe('Lillo');
    expect(patient.birthDate).toBe('1974-05-18');
    expect(patient.age).toBe('52');
    expect(patient.biologicalSex).toBe('Femenino');
    expect(patient.admissionDate).toBe('2026-07-08');
    expect(patient.admissionTime).toBe('14:19');
    expect(patient.pathology).toBe('Problemas relacionados con otras circunstancias legales');
    expect(patient.isUPC).toBe(false);
    expect(patient.isIsolated).toBe(false);
  });

  it('maps the principal Ficha Medico diagnosis and its CIE-10 code', () => {
    const { patient } = rayenToPatientData(
      baseEncounter({
        diagnosis: 'Neumonía bacteriana',
        diagnosisCode: 'J15.9',
        diagnosisDescription: 'Neumonía bacteriana, no especificada',
      }),
      REFERENCE
    );

    expect(patient.pathology).toBe('Neumonía bacteriana');
    expect(patient.cie10Code).toBe('J15.9');
    expect(patient.cie10Description).toBe('Neumonía bacteriana, no especificada');
  });

  it('omits both CIE-10 fields when the source code contains only whitespace', () => {
    const { patient } = rayenToPatientData(
      baseEncounter({ diagnosisCode: '   ', diagnosisDescription: 'Descripción huérfana' }),
      REFERENCE
    );

    expect(patient.cie10Code).toBeUndefined();
    expect(patient.cie10Description).toBeUndefined();
  });

  it('maps the isolation flag from the encounter', () => {
    expect(
      rayenToPatientData(baseEncounter({ isIsolated: true }), REFERENCE).patient.isIsolated
    ).toBe(true);
  });

  it('normalizes names to Title Case regardless of the casing Rayen returns', () => {
    const { patient } = rayenToPatientData(
      baseEncounter({
        firstGivenName: 'JUAN CARLOS',
        firstFamilyName: 'DE LA FUENTE',
        secondFamilyName: ' ÑIREHUAO',
      }),
      REFERENCE
    );
    expect(patient.firstName).toBe('Juan Carlos');
    expect(patient.lastName).toBe('De La Fuente');
    expect(patient.secondLastName).toBe('Ñirehuao');
    expect(patient.patientName).toBe('Juan Carlos De La Fuente Ñirehuao');
  });

  it('defaults a synced patient to status "Estable"', () => {
    const { patient } = rayenToPatientData(baseEncounter(), REFERENCE);
    expect(patient.status).toBe('Estable');
  });

  it('flags CMA but never auto-classifies a synced patient as UPC (defaults to non-UPC)', () => {
    const { patient, isCma, bedId } = rayenToPatientData(
      baseEncounter({ room: 'CMA R1', bed: 'CMAR1', service: 'Área quirúrgica indiferenciada' }),
      REFERENCE
    );
    expect(isCma).toBe(true);
    expect(bedId).toBe('R1');
    // The bed is UTI, but sync must not mark the patient UPC — the nurse categorizes that in HHR.
    expect(patient.isUPC).toBe(false);
  });

  it('leaves bedId empty when the location is unmappable', () => {
    const { patient, bedId } = rayenToPatientData(
      baseEncounter({ room: 'ZZ', bed: 'QQ' }),
      REFERENCE
    );
    expect(bedId).toBeNull();
    expect(patient.bedId).toBe('');
  });
});
