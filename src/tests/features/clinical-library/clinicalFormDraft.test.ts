import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getClinicalForm } from '@/features/clinical-library/domain/forms/clinicalFormCatalog';
import {
  exportClinicalFormDraft,
  importClinicalFormDraft,
  setClinicalFormValue,
  validateClinicalFormValues,
} from '@/features/clinical-library/domain/forms/clinicalFormDraft';
import {
  emptyClinicalFormPreferences,
  loadClinicalFormPreferences,
  parseClinicalFormPreferences,
  saveClinicalFormPreferences,
  serializeClinicalFormPreferences,
} from '@/features/clinical-library/domain/forms/clinicalFormPreferences';

const consent = getClinicalForm('consentimiento-informado');
describe('clinical form drafts and preferences', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips an explicit no, dates, Spanish text and local fields across forms', () => {
    const values = {
      paciente_nombre_completo: 'PACIENTE ÁÉÑ',
      consentimiento_decision: false,
      formulario_fecha_emision: '2026-10-16',
    };
    expect(importClinicalFormDraft(exportClinicalFormDraft(consent.id, values))).toEqual({
      formId: consent.id,
      values,
    });
  });

  it('allows incomplete RUT drafts, exports only this form and keeps document dates separate', () => {
    const values = { paciente_rut: '11.', consentimiento_decision: false, contraste_operado: true };
    const imported = importClinicalFormDraft(exportClinicalFormDraft(consent.id, values));
    expect(imported.values.paciente_rut).toBe('11.');
    expect(imported.values).not.toHaveProperty('contraste_operado');
    expect(() => validateClinicalFormValues(consent, imported.values, [])).toThrow('RUT');
  });

  it('restores patient data from older VMI drafts without reviving observations or alarm values', () => {
    const patient = {
      paciente_nombre_completo: 'PACIENTE VMI PRUEBA',
      paciente_rut: '11.111.111-1',
      ingreso_fecha: '2026-10-13',
    };
    const imported = importClinicalFormDraft(
      JSON.stringify({
        kind: 'hhr-clinical-form-draft',
        version: 1,
        formId: 'planilla-monitorizacion-ventilatoria',
        values: {
          ...patient,
          vmi_registro_1_hora: '08:00',
          vmi_alarma_dia_vt: '500',
          vmi_coincide_dia: true,
          vmi_fecha: '2026-10-16',
        },
      })
    );
    expect(imported.values).toEqual(patient);
    expect(JSON.parse(exportClinicalFormDraft(imported.formId, imported.values)).values).toEqual(
      patient
    );
  });

  it('rejects unknown fields, invalid types, impossible dates and conflicting document identities', () => {
    const invalid = [
      { unknown: 'test' },
      { consentimiento_decision: 'no' },
      { formulario_fecha_emision: '2026-02-30' },
      { paciente_nombre_completo: {} },
      {
        paciente_rut: '11.111.111-1',
        paciente_documento_numero: 'AB00001',
        paciente_documento_tipo: 'Pasaporte',
      },
    ];
    for (const values of invalid)
      expect(() =>
        importClinicalFormDraft(
          JSON.stringify({
            kind: 'hhr-clinical-form-draft',
            version: 1,
            formId: consent.id,
            values,
          })
        )
      ).toThrow();
    expect(() => importClinicalFormDraft('{}')).toThrow();
  });

  it('updates the personal RUT alias without corrupting a passport', () => {
    expect(setClinicalFormValue({}, 'paciente_rut', '11.111.111-1')).toMatchObject({
      paciente_documento_tipo: 'RUT',
      paciente_documento_numero: '11.111.111-1',
    });
    expect(
      setClinicalFormValue(
        { paciente_documento_tipo: 'Pasaporte' },
        'paciente_documento_numero',
        'AB00001'
      ).paciente_rut
    ).toBeNull();
  });

  it('validates a chosen RUT in mixed RUT/passport fields and preserves passport zeros', () => {
    const form = getClinicalForm('solicitud-serologia-hepatitis-chagas');
    expect(() =>
      validateClinicalFormValues(
        form,
        { paciente_documento_tipo: 'RUT', paciente_documento_numero: '11.111.111-2' },
        []
      )
    ).toThrow('RUT');
    expect(
      validateClinicalFormValues(
        form,
        { paciente_documento_tipo: 'Pasaporte', paciente_documento_numero: 'AB0000123' },
        []
      ).paciente_documento_numero
    ).toBe('AB0000123');
  });

  it('reuses manually entered structured names in full-name forms without guessing surnames or replacing independent edits', () => {
    let values = setClinicalFormValue({}, 'paciente_nombres', 'PACIENTE COMPUESTO');
    values = setClinicalFormValue(values, 'paciente_apellido_paterno', 'DE PRUEBA');
    values = setClinicalFormValue(values, 'paciente_apellido_materno', 'ALFA');
    expect(values.paciente_nombre_completo).toBe('PACIENTE COMPUESTO DE PRUEBA ALFA');
    values = setClinicalFormValue(
      values,
      'paciente_nombre_completo',
      'NOMBRE EDITADO INDEPENDIENTEMENTE'
    );
    expect(setClinicalFormValue(values, 'paciente_nombres', 'OTRO').paciente_nombre_completo).toBe(
      'NOMBRE EDITADO INDEPENDIENTEMENTE'
    );
    expect(setClinicalFormValue({}, 'paciente_nombre_completo', 'NOMBRE LIBRE')).not.toHaveProperty(
      'paciente_apellido_paterno'
    );
  });

  it('makes suppressed data blank, skips its validation and preserves the underlying draft', () => {
    const values = { paciente_rut: 'RUT inválido', paciente_nombre_completo: 'NOMBRE' };
    expect(() => validateClinicalFormValues(consent, values, [])).toThrow('RUT');
    expect(validateClinicalFormValues(consent, values, ['paciente_rut'])).toMatchObject({
      paciente_rut: null,
      paciente_nombre_completo: 'NOMBRE',
    });
    expect(values.paciente_rut).toBe('RUT inválido');
  });

  it('persists only versioned configuration, strips extra data and rejects another template', () => {
    const preferences = {
      ...emptyClinicalFormPreferences(consent),
      hidden: ['paciente_nombre_completo'],
    };
    const imported = parseClinicalFormPreferences(
      JSON.stringify({
        ...preferences,
        values: { paciente_nombre_completo: 'DATOS PRIVADOS' },
        medico: 'DATOS PRIVADOS',
      }),
      consent
    );
    expect(serializeClinicalFormPreferences(imported)).not.toContain('DATOS PRIVADOS');
    expect(saveClinicalFormPreferences(consent, imported)).toBe(true);
    expect(loadClinicalFormPreferences(consent)).toEqual(preferences);
    expect(() =>
      parseClinicalFormPreferences(
        serializeClinicalFormPreferences(preferences),
        getClinicalForm('encuesta-contraste')
      )
    ).toThrow();
    vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
      throw new Error('unavailable');
    });
    expect(saveClinicalFormPreferences(consent, preferences)).toBe(false);
  });
});
