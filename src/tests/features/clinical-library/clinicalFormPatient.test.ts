import { describe, expect, it } from 'vitest';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import type { PatientData } from '@/shared/contracts/patientDomainContracts';
import type { MedifSourceRecord } from '@/features/clinical-library/domain/medifPatientPrefill';
import {
  buildClinicalFormPatientOptions,
  mergeEmptyFormValues,
} from '@/features/clinical-library/domain/forms/clinicalFormPatient';
import {
  formAgeAt,
  formatFormDate,
  parseFormDate,
} from '@/features/clinical-library/domain/forms/clinicalFormDates';

const patient = (patch: Partial<PatientData> = {}): PatientData => ({
  ...createEmptyPatient('R1'),
  patientName: 'PACIENTE PRUEBA',
  firstName: 'PACIENTE',
  lastName: 'PRUEBA',
  rut: '11.111.111-1',
  documentType: 'RUT',
  identityStatus: 'official',
  admissionDate: '2026-10-13',
  clinicalEpisodeId: 'synthetic-episode',
  pathology: 'Diagnóstico de prueba',
  ...patch,
});
const record = (p = patient()): MedifSourceRecord => ({
  date: '2026-10-16',
  lastUpdated: '2026-10-16T12:00:00Z',
  beds: { R1: p },
  activeExtraBeds: [],
});

describe('shared form census projection', () => {
  it('copies structured identity, episode, diagnosis and physician without modifying the source', () => {
    const source = record(
      patient({
        treatingPhysicianName: 'MÉDICO DE PRUEBA',
        cie10Code: 'Z00',
        admissionTime: '08:15',
      })
    );
    const before = JSON.stringify(source);
    const [option] = buildClinicalFormPatientOptions(source);
    expect(option.values).toMatchObject({
      paciente_nombre_completo: 'PACIENTE PRUEBA',
      paciente_nombres: 'PACIENTE',
      paciente_apellido_paterno: 'PRUEBA',
      paciente_rut: '11.111.111-1',
      ingreso_fecha: '2026-10-13',
      ingreso_hora: '08:15',
      diagnostico_texto: 'Diagnóstico de prueba',
      diagnostico_cie10_codigo: 'Z00',
      medico_tratante_nombre: 'MÉDICO DE PRUEBA',
    });
    expect(option.provenance.paciente_rut).toMatchObject({
      sourcePath: 'beds.R1.rut',
      transformation: 'verifiedRut',
      recordDate: '2026-10-16',
    });
    expect(JSON.stringify(source)).toBe(before);
    expect(option.values).not.toHaveProperty('contraste_alergia');
    expect(option.values).not.toHaveProperty('consentimiento_decision');
  });

  it('keeps a clinical crib independent and never borrows its maternal document', () => {
    const source = record(
      patient({
        clinicalCrib: patient({
          patientName: 'RN DE PRUEBA',
          firstName: undefined,
          lastName: undefined,
          identityStatus: 'provisional',
          rut: '',
          neonatalMaternalRut: '11.111.111-1',
          age: '3 días',
          clinicalEpisodeId: 'synthetic-newborn',
        }),
      })
    );
    const options = buildClinicalFormPatientOptions(source);
    expect(options).toHaveLength(2);
    expect(options[1].context.location).toBe('clinicalCrib');
    expect(options[1].values.paciente_edad_texto).toBe('3 días');
    expect(options[1].values).not.toHaveProperty('paciente_rut');
    expect(options[1].values).not.toHaveProperty('paciente_nombres');
    expect(options[1].provenance.diagnostico_texto.sourcePath).toBe(
      'beds.R1.clinicalCrib.pathology'
    );
  });

  it('preserves passport zeros and refuses to label passports or invalid/unknown RUTs as a verified RUT', () => {
    const [passport] = buildClinicalFormPatientOptions(
      record(patient({ rut: 'AB0000123', documentType: 'Pasaporte' }))
    );
    expect(passport.values.paciente_documento_numero).toBe('AB0000123');
    expect(passport.values).not.toHaveProperty('paciente_rut');
    for (const p of [patient({ rut: '11.111.111-2' }), patient({ documentType: undefined })]) {
      expect(buildClinicalFormPatientOptions(record(p))[0].values).not.toHaveProperty(
        'paciente_rut'
      );
    }
  });

  it('excludes empty, blocked, inactive extra and CMA beds, but changes key when a bed is reused', () => {
    expect(buildClinicalFormPatientOptions(null)).toEqual([]);
    expect(buildClinicalFormPatientOptions({ ...record(), date: '2026-02-30' })).toEqual([]);
    const source = record();
    source.beds = {
      R1: patient({ isBlocked: true }),
      R2: patient({ patientName: '' }),
      E1: patient(),
      CMA_R4: patient(),
    };
    expect(buildClinicalFormPatientOptions(source)).toEqual([]);
    const [first] = buildClinicalFormPatientOptions(record());
    const [next] = buildClinicalFormPatientOptions(
      record(patient({ clinicalEpisodeId: 'next-episode' }))
    );
    expect(next.key).not.toBe(first.key);
  });

  it('refreshes only empty values and treats false and zero text as completed', () => {
    expect(
      mergeEmptyFormValues(
        { nombre: 'EDITADO', no: false, cero: '0', vacio: '' },
        { nombre: 'CENSO', no: true, cero: '123', vacio: 'NUEVO' }
      )
    ).toEqual({ nombre: 'EDITADO', no: false, cero: '0', vacio: 'NUEVO' });
  });

  it('preserves calendar dates and infant units without borrowing the admission date for other dates', () => {
    expect(parseFormDate('2026-02-29')).toBeNull();
    expect(formatFormDate('2026-10-16')).toBe('16/10/2026');
    expect(formAgeAt('2026-10-13', '2026-10-16')).toBe('3 días');
    expect(formAgeAt('2026-08-16', '2026-10-16')).toBe('2 meses');
    const [option] = buildClinicalFormPatientOptions(
      record(patient({ age: '', birthDate: '2026-10-13' }))
    );
    expect(option.values.paciente_edad_texto).toBe('3 días');
    expect(option.values).not.toHaveProperty('formulario_fecha_emision');
    expect(option.values).not.toHaveProperty('serologia_fecha_muestra');
  });
});
