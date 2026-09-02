import { describe, expect, it } from 'vitest';
import {
  ageFromBirthDate,
  formatRun,
  mapBiologicalSex,
  cleanDiagnosis,
  rayenToPatientData,
  normalizeOptionalPersonName,
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

  it('uses clinically useful day, month and year precision for pediatric ages', () => {
    const reference = new Date(2026, 6, 21);

    expect(ageFromBirthDate('2026-07-21', reference)).toBe('0d');
    expect(ageFromBirthDate('2026-07-01', reference)).toBe('20d');
    expect(ageFromBirthDate('2026-05-16', reference)).toBe('2m 5d');
    expect(ageFromBirthDate('2026-01-21', reference)).toBe('6m');
    expect(ageFromBirthDate('2024-08-21', reference)).toBe('23m');
    expect(ageFromBirthDate('2024-04-21', reference)).toBe('2a 3m');
    expect(ageFromBirthDate('2022-08-21', reference)).toBe('3a 11m');
    expect(ageFromBirthDate('2022-07-21', reference)).toBe('4');
  });

  it('counts a clamped month anniversary at the end of a shorter month', () => {
    expect(ageFromBirthDate('2026-01-31', new Date(2026, 1, 28))).toBe('1m 0d');
    expect(ageFromBirthDate('2026-08-31', new Date(2026, 8, 30))).toBe('1m 0d');
    expect(ageFromBirthDate('2026-01-31', new Date(2026, 1, 27))).toBe('27d');
  });

  it('rejects impossible and future birth dates', () => {
    expect(ageFromBirthDate('2026-02-31', REFERENCE)).toBe('');
    expect(ageFromBirthDate('2027-01-01', REFERENCE)).toBe('');
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

  it('toTitleCaseName colapsa los espacios internos del relleno de Rayen', () => {
    // El doble espacio del caso real («Jorge  Urgencias Aroca») venía de unir
    // dos campos donde uno traía relleno; trim() solo limpiaba los extremos.
    expect(toTitleCaseName('  JORGE   AROCA  ')).toBe('Jorge Aroca');
  });

  it('treats Rayen missing-name placeholders as an empty optional name', () => {
    expect(normalizeOptionalPersonName('Noinformado')).toBe('');
    expect(normalizeOptionalPersonName('NO INFORMADO')).toBe('');
    expect(normalizeOptionalPersonName('Sin información')).toBe('');
    expect(normalizeOptionalPersonName('ÑIREHUAO')).toBe('Ñirehuao');
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

  it('no arrastra al censo el marcador de urgencias que Rayen deja entre los nombres', () => {
    // Caso real (01-09, cama H2C2): Rayen entregaba «Jorge  Urgencias» como
    // nombres del paciente y el censo mostraba «Jorge Urgencias Aroca
    // Benavides» en vez de «Jorge Aroca Benavides».
    const { patient } = rayenToPatientData(
      baseEncounter({
        firstGivenName: 'JORGE ',
        nextGivenNames: 'URGENCIAS',
        firstFamilyName: 'AROCA',
        secondFamilyName: 'BENAVIDES',
      }),
      REFERENCE
    );

    expect(patient.patientName).toBe('Jorge Aroca Benavides');
    expect(patient.firstName).toBe('Jorge');
    expect(patient.lastName).toBe('Aroca');
    expect(patient.secondLastName).toBe('Benavides');
  });

  it('si TODOS los nombres de pila son marcadores, quedan vacíos y el paciente se identifica por apellidos', () => {
    // Contrato declarado (seguimiento de #295): un ingreso registrado solo con el
    // marcador del punto de atención no tiene nombre de pila real. Inventar uno
    // sería peor; conservar «Urgencias» como nombre también. Queda vacío y visible
    // por apellidos, igual que un nombre de pila no informado.
    const { patient } = rayenToPatientData(
      baseEncounter({
        firstGivenName: 'URGENCIAS',
        nextGivenNames: '',
        firstFamilyName: 'AROCA',
        secondFamilyName: 'BENAVIDES',
      }),
      REFERENCE
    );

    expect(patient.firstName).toBe('');
    expect(patient.patientName).toBe('Aroca Benavides');
    expect(patient.lastName).toBe('Aroca');
  });

  it('solo poda la palabra completa: nunca mutila un nombre real que la contenga', () => {
    // La poda es por token exacto (mismo criterio que los placeholders de
    // Rayen). Un nombre legítimo debe sobrevivir intacto.
    const { patient } = rayenToPatientData(
      baseEncounter({
        firstGivenName: 'Urgencio',
        nextGivenNames: 'Sapunar',
        firstFamilyName: 'Sapunar',
        secondFamilyName: '',
      }),
      REFERENCE
    );

    expect(patient.firstName).toBe('Urgencio Sapunar');
    expect(patient.lastName).toBe('Sapunar');
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
    const { patient } = rayenToPatientData(
      baseEncounter({
        isIsolated: true,
        isolationType: 'Gotas',
        isolationMicroorganism: 'Virus Influenza B',
      }),
      REFERENCE
    );

    expect(patient.isIsolated).toBe(true);
    expect(patient.isolationType).toBe('Gotas');
    expect(patient.isolationMicroorganism).toBe('Virus Influenza B');
  });

  it('maps the treating physician and only an explicitly configured HHR specialty', () => {
    const { patient } = rayenToPatientData(
      baseEncounter({
        treatingPhysicianId: '7947',
        treatingPhysicianName: 'Angelica Vargas',
        treatingPhysicianSpecialty: 'Psiquiatría',
      }),
      REFERENCE
    );

    expect(patient.treatingPhysicianId).toBe('7947');
    expect(patient.treatingPhysicianName).toBe('Angelica Vargas');
    expect(patient.specialty).toBe('Psiquiatría');
  });

  it('keeps isolation metadata absent when only the active flag is available', () => {
    const { patient } = rayenToPatientData(baseEncounter({ isIsolated: true }), REFERENCE);

    expect(patient.isIsolated).toBe(true);
    expect(patient.isolationType).toBeUndefined();
    expect(patient.isolationMicroorganism).toBeUndefined();
  });

  it('drops stale isolation metadata when the encounter is inactive', () => {
    const { patient } = rayenToPatientData(
      baseEncounter({
        isIsolated: false,
        isolationType: 'Gotas',
        isolationMicroorganism: 'Virus Influenza B',
      }),
      REFERENCE
    );

    expect(patient.isIsolated).toBe(false);
    expect(patient.isolationType).toBeUndefined();
    expect(patient.isolationMicroorganism).toBeUndefined();
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

  it('omits a missing second surname placeholder from identity fields and full name', () => {
    const { patient } = rayenToPatientData(
      baseEncounter({
        firstGivenName: 'LAURADELCARMEN',
        firstFamilyName: 'TUKI',
        secondFamilyName: 'Noinformado',
      }),
      REFERENCE
    );

    expect(patient.secondLastName).toBe('');
    expect(patient.patientName).toBe('Lauradelcarmen Tuki');
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
