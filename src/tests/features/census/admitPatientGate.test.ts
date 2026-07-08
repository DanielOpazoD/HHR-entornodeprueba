import { describe, expect, it } from 'vitest';
import {
  resolveEmptyBedSaveAction,
  resolvePureAdmissionInput,
} from '@/features/census/controllers/admitPatientGate';
import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';

describe('resolvePureAdmissionInput', () => {
  it('returns the typed input when only the four admission fields are present', () => {
    const result = resolvePureAdmissionInput({
      patientName: 'Paciente Demo',
      rut: '11.111.111-1',
      admissionDate: '2026-05-03',
      pathology: 'Diagnóstico demo',
    } as Partial<PatientData>);

    expect(result).toEqual({
      patientName: 'Paciente Demo',
      rut: '11.111.111-1',
      admissionDate: '2026-05-03',
      pathology: 'Diagnóstico demo',
    });
  });

  it('returns the typed input when pathology is omitted (still pure admission)', () => {
    const result = resolvePureAdmissionInput({
      patientName: 'Paciente Demo',
      rut: '11.111.111-1',
      admissionDate: '2026-05-03',
    } as Partial<PatientData>);

    expect(result).toEqual({
      patientName: 'Paciente Demo',
      rut: '11.111.111-1',
      admissionDate: '2026-05-03',
      pathology: undefined,
    });
  });

  it('trims whitespace on the required fields', () => {
    const result = resolvePureAdmissionInput({
      patientName: '  Paciente Demo  ',
      rut: '  11.111.111-1  ',
      admissionDate: '  2026-05-03  ',
    } as Partial<PatientData>);

    expect(result?.patientName).toBe('Paciente Demo');
    expect(result?.rut).toBe('11.111.111-1');
    expect(result?.admissionDate).toBe('2026-05-03');
  });

  it.each([
    ['patientName missing', { rut: 'r', admissionDate: 'd' }],
    ['rut missing', { patientName: 'p', admissionDate: 'd' }],
    ['admissionDate missing', { patientName: 'p', rut: 'r' }],
  ])('returns null when %s', (_label, fields) => {
    expect(resolvePureAdmissionInput(fields as Partial<PatientData>)).toBeNull();
  });

  it.each([
    ['empty patientName', { patientName: '', rut: 'r', admissionDate: 'd' }],
    ['whitespace rut', { patientName: 'p', rut: '   ', admissionDate: 'd' }],
    ['empty admissionDate', { patientName: 'p', rut: 'r', admissionDate: '' }],
  ])('returns null when %s', (_label, fields) => {
    expect(resolvePureAdmissionInput(fields as Partial<PatientData>)).toBeNull();
  });

  it('returns null when a non-admission field is present (mixed edit)', () => {
    const result = resolvePureAdmissionInput({
      patientName: 'p',
      rut: 'r',
      admissionDate: 'd',
      bedMode: 'Cama',
    } as unknown as Partial<PatientData>);
    expect(result).toBeNull();
  });

  it('returns null when devices or status are present (mixed edit)', () => {
    const result = resolvePureAdmissionInput({
      patientName: 'p',
      rut: 'r',
      admissionDate: 'd',
      devices: [],
    } as unknown as Partial<PatientData>);
    expect(result).toBeNull();
  });
});

describe('resolveEmptyBedSaveAction', () => {
  const pureAdmissionFields = {
    patientName: 'Paciente Demo',
    rut: '11.111.111-1',
    admissionDate: '2026-05-03',
    pathology: 'Diagnóstico demo',
  } as Partial<PatientData>;

  it('returns noop when no patientName / rut were entered', () => {
    expect(
      resolveEmptyBedSaveAction({
        updatedFields: { admissionDate: '2026-05-03' } as Partial<PatientData>,
        isAdmitCommandEnabled: true,
      })
    ).toEqual({ kind: 'noop' });

    expect(
      resolveEmptyBedSaveAction({
        updatedFields: {} as Partial<PatientData>,
        isAdmitCommandEnabled: false,
      })
    ).toEqual({ kind: 'noop' });
  });

  it('routes to admit-command when flag is ON and input is a pure admission', () => {
    const result = resolveEmptyBedSaveAction({
      updatedFields: pureAdmissionFields,
      isAdmitCommandEnabled: true,
    });

    expect(result).toEqual({
      kind: 'admit-command',
      input: {
        patientName: 'Paciente Demo',
        rut: '11.111.111-1',
        admissionDate: '2026-05-03',
        pathology: 'Diagnóstico demo',
      },
    });
  });

  it('routes to legacy-dispatch when flag is OFF even on pure admission', () => {
    const result = resolveEmptyBedSaveAction({
      updatedFields: pureAdmissionFields,
      isAdmitCommandEnabled: false,
    });

    expect(result).toEqual({ kind: 'legacy-dispatch', input: pureAdmissionFields });
  });

  it('routes to legacy-dispatch when flag is ON but input mixes non-admission fields', () => {
    const mixedFields = {
      ...pureAdmissionFields,
      bedMode: 'Cama',
    } as unknown as Partial<PatientData>;

    const result = resolveEmptyBedSaveAction({
      updatedFields: mixedFields,
      isAdmitCommandEnabled: true,
    });

    expect(result).toEqual({ kind: 'legacy-dispatch', input: mixedFields });
  });

  it('routes to legacy-dispatch when flag is ON but admission is incomplete (missing rut)', () => {
    const incompleteAdmission = {
      patientName: 'Paciente Demo',
      admissionDate: '2026-05-03',
    } as Partial<PatientData>;

    const result = resolveEmptyBedSaveAction({
      updatedFields: incompleteAdmission,
      isAdmitCommandEnabled: true,
    });

    expect(result).toEqual({ kind: 'legacy-dispatch', input: incompleteAdmission });
  });
});
