import { describe, expect, it } from 'vitest';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { PatientStatus } from '@/types/domain/patientClassification';
import type { PatientData } from '@/types/domain/patient';
import {
  buildMedifPatientOptions,
  prefillMedifPatient,
  type MedifSourceRecord,
} from '@/features/clinical-library/domain/medifPatientPrefill';

const patient = (bedId: string, patch: Partial<PatientData> = {}): PatientData => ({
  ...createEmptyPatient(bedId),
  patientName: 'Paciente de demostración',
  age: '42 años',
  pathology: 'Diagnóstico ficticio',
  admissionDate: '2026-10-13',
  ...patch,
});

const record = (beds: Record<string, PatientData>): MedifSourceRecord => ({
  date: '2026-10-15',
  lastUpdated: '2026-10-15T12:00:00Z',
  activeExtraBeds: [],
  beds,
});

const prefill = (patch: Partial<PatientData>, date = '2026-10-15') => {
  const source = { ...record({ R1: patient('R1', patch) }), date };
  return prefillMedifPatient(buildMedifPatientOptions(source)[0]);
};

describe('MEDIF patient prefill', () => {
  it('lists occupied beds and independent clinical cribs with distinct identities', () => {
    const source = record({
      R1: patient('R1', {
        clinicalEpisodeId: 'demo-parent',
        clinicalCrib: patient('R1', {
          patientName: 'RN de demostración',
          age: '3 días',
          pathology: 'Diagnóstico ficticio RN',
          clinicalEpisodeId: 'demo-crib',
        }),
      }),
      NEO1: patient('NEO1', { bedMode: 'Cuna' }),
    });
    const options = buildMedifPatientOptions(source);
    expect(options.map(option => [option.bedId, option.location])).toEqual([
      ['R1', 'bed'],
      ['R1', 'clinicalCrib'],
      ['NEO1', 'bed'],
    ]);
    expect(new Set(options.map(option => option.key)).size).toBe(3);
    expect(options[1].label).toContain('Cuna clínica');
    const result = prefillMedifPatient(options[1]);
    expect(result.fields.p1_nombre_pasajero).toBe('RN de demostración');
    expect(result.fields.p2_edad).toBe('3 días');
    expect(result.fields.p2_diagnostico_actual).toBe('Diagnóstico ficticio RN');
    expect(result.provenance.p2_diagnostico_actual.sourcePath).toBe(
      'beds.R1.clinicalCrib.pathology'
    );
  });

  it('excludes blocked, empty, unnamed, unknown, inactive extra and CMA beds', () => {
    const source = record({
      R1: patient('R1', { isBlocked: true, clinicalCrib: patient('R1') }),
      R2: patient('R2', { patientName: ' ', rut: 'synthetic-id-only' }),
      R3: createEmptyPatient('R3'),
      E1: patient('E1'),
      BOX1: patient('BOX1'),
      CMA_R4: patient('CMA_R4'),
      unknown: patient('unknown'),
    });
    source.activeExtraBeds = ['CMA_R4'];
    expect(buildMedifPatientOptions(source)).toEqual([]);
  });

  it('includes active extras and virtual emergency beds using the canonical bed labels', () => {
    const source = record({ E1: patient('E1'), BOX1: patient('BOX1') });
    source.activeExtraBeds = ['E1', 'BOX1'];
    expect(buildMedifPatientOptions(source).map(option => option.bedLabel)).toEqual([
      'E1',
      'B1UEA',
    ]);
  });

  it('excludes blocked and unnamed clinical cribs', () => {
    expect(
      buildMedifPatientOptions(
        record({
          R1: patient('R1', { clinicalCrib: patient('R1', { isBlocked: true }) }),
          R2: patient('R2', {
            clinicalCrib: patient('R2', { patientName: '', identityStatus: 'provisional' }),
          }),
        })
      )
    ).toHaveLength(2);
  });

  it('does not mistake severity or a clinical discharge awaiting physical departure for an empty bed', () => {
    const source = record({
      R1: patient('R1', {
        status: PatientStatus.EMPTY,
        dischargeVerification: { medicalEpicrisis: 'confirmed', nursingEpicrisis: 'unknown' },
      }),
    });
    expect(buildMedifPatientOptions(source)).toHaveLength(1);
  });

  it('copies the seven requested fields with reviewable sex and admission date', () => {
    const output = prefill({
      diagnosisComments: 'No es un informe médico',
      biologicalSex: 'Femenino',
      treatingPhysicianName: 'Profesional de demostración',
      insurance: 'Fonasa',
      specialty: 'Cirugía',
      isUPC: true,
      devices: ['O2'],
    });
    expect(output.fields).toEqual({
      p1_nombre_pasajero: 'Paciente de demostración',
      p2_nombre_paciente: 'Paciente de demostración',
      p1_edad: '42 años',
      p2_edad: '42 años',
      p2_diagnostico_actual: 'Diagnóstico ficticio',
      p2_genero: 'Femenino',
      p2_contagiosa_fecha_tipo: '13/10/2026',
    });
    expect(Object.values(output.provenance).every(item => item.requiresReview)).toBe(true);
    expect(output.provenance.p2_diagnostico_actual.transformation).toBe('copyAsDraft');
    expect(output.provenance.p2_genero.sourcePath).toBe('beds.R1.biologicalSex');
    expect(output.provenance.p2_contagiosa_fecha_tipo.sourcePath).toBe('beds.R1.admissionDate');
    expect(output.provenance.p2_contagiosa_fecha_tipo.transformation).toBe(
      'admissionDateAsRequested'
    );
  });

  it.each(['', '2026-02-30', '2026-10-16', '13/10/2026'])(
    'leaves the admission-date field blank for invalid or future source %s',
    admissionDate => {
      expect(prefill({ admissionDate }).fields).not.toHaveProperty('p2_contagiosa_fecha_tipo');
    }
  );

  it('leaves sex blank when absent and uses the clinical crib own data', () => {
    expect(prefill({ biologicalSex: undefined }).fields).not.toHaveProperty('p2_genero');
    const options = buildMedifPatientOptions(
      record({
        R1: patient('R1', {
          biologicalSex: 'Femenino',
          admissionDate: '2026-10-13',
          clinicalCrib: patient('R1', {
            biologicalSex: 'Masculino',
            admissionDate: '2026-10-14',
          }),
        }),
      })
    );
    const crib = prefillMedifPatient(options[1]);
    expect(crib.fields.p2_genero).toBe('Masculino');
    expect(crib.fields.p2_contagiosa_fecha_tipo).toBe('14/10/2026');
    expect(crib.provenance.p2_genero.sourcePath).toBe('beds.R1.clinicalCrib.biologicalSex');
  });

  it('does not mutate the census or expose RUT, notes, devices or a complete patient object', () => {
    const source = record({
      R1: patient('R1', { rut: 'DO-NOT-COPY', medicalHandoffNote: 'DO-NOT-COPY' }),
    });
    const original = structuredClone(source);
    const option = buildMedifPatientOptions(source)[0];
    expect(JSON.stringify(option)).not.toContain('DO-NOT-COPY');
    option.sourceSnapshot.patientName = 'Edición de demostración';
    prefillMedifPatient(option);
    expect(source).toEqual(original);
  });

  it.each(['12 días', '6 meses', '1 año', '0'])('preserves the recorded age text %s', age => {
    const result = prefill({ age, birthDate: '1984-01-01' });
    expect(result.fields.p1_edad).toBe(age);
    expect(result.fields.p2_edad).toBe(age);
    expect(result.provenance.p1_edad.sourcePath).toBe('beds.R1.age');
  });

  it.each([
    ['2000-10-16', '2026-10-15', '25 años'],
    ['2000-10-16', '2026-10-16', '26 años'],
    ['2026-10-15', '2026-10-15', '0 días'],
    ['2026-10-03', '2026-10-15', '12 días'],
    ['2026-08-15', '2026-10-15', '2 meses'],
    ['2025-10-15', '2026-10-15', '1 año'],
    ['2000-02-29', '2025-02-28', '24 años'],
    ['2000-02-29', '2025-03-01', '25 años'],
  ])('calculates birth date %s on the explicit census day %s', (birthDate, date, expected) => {
    const result = prefill({ age: '', birthDate }, date);
    expect(result.fields.p1_edad).toBe(expected);
    expect(result.provenance.p1_edad.transformation).toBe(`calendarAgeAt:${date}`);
  });

  it.each([
    '2026-02-30',
    '2025-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-10-32',
    '2026-10-16',
    '03/10/2026',
    '',
  ])('does not calculate age from an invalid or future date %s', birthDate => {
    const result = prefill({ age: '', birthDate });
    expect(result.fields).not.toHaveProperty('p1_edad');
    expect(result.fields).not.toHaveProperty('p2_edad');
  });

  it('changes identity when a legacy bed changes patient or admission date, even without an episode ID', () => {
    const first = buildMedifPatientOptions(record({ R1: patient('R1') }))[0];
    const replacement = buildMedifPatientOptions(
      record({ R1: patient('R1', { patientName: 'Otra persona de demostración' }) })
    )[0];
    const readmission = buildMedifPatientOptions(
      record({ R1: patient('R1', { admissionDate: '2026-10-15' }) })
    )[0];
    expect(replacement.key).not.toBe(first.key);
    expect(readmission.key).not.toBe(first.key);
  });

  it('retains the source day and revision for historical records', () => {
    const result = prefill({}, '2025-06-10');
    expect(result.context.recordDate).toBe('2025-06-10');
    expect(result.context.sourceLastUpdated).toBe('2026-10-15T12:00:00Z');
  });

  it('returns no options before a valid census is available', () => {
    expect(buildMedifPatientOptions(null)).toEqual([]);
    expect(
      buildMedifPatientOptions({ ...record({ R1: patient('R1') }), date: '2026-02-30' })
    ).toEqual([]);
  });
});
