import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CLINICAL_FORMS,
  getClinicalForm,
} from '@/features/clinical-library/domain/forms/clinicalFormCatalog';
import {
  exportClinicalFormDraft,
  importClinicalFormDraft,
  setClinicalFormValue,
  validateClinicalFormValues,
} from '@/features/clinical-library/domain/forms/clinicalFormDraft';
import { mergeEmptyFormValues } from '@/features/clinical-library/domain/forms/clinicalFormPatient';
import {
  emptyMedifValues,
  setMedifFieldValue,
} from '@/features/clinical-library/domain/medifDraft';
import { applyMedifHabitualAnswers } from '@/features/clinical-library/domain/medifHabitualAnswers';
import {
  emptyMedifPreferences,
  setMedifFieldHidden,
  filterMedifExportValues,
} from '@/features/clinical-library/domain/medifPreferences';
import { MEDIF_GROUPS } from '@/features/clinical-library/domain/medifSchema';
import type { ClinicalFormValues } from '@/features/clinical-library/domain/forms/clinicalFormTypes';

// Fixed seed and bounded runs keep failures reproducible in local work and CI.
const checks = { seed: 20261023, numRuns: 75 };
const text = fc
  .array(fc.constantFrom('A', 'Z', 'Ñ', 'á', 'é', '0', '9', ' '), { minLength: 1, maxLength: 25 })
  .map(characters => `PRUEBA ${characters.join('')}`);
const groups = MEDIF_GROUPS.filter(group => group.type === 'choice');

describe('clinical form invariants across generated inputs', () => {
  it('preserves reviewed false, zero text and accented text while filling only missing fields', () => {
    fc.assert(
      fc.property(text, text, fc.boolean(), (reviewed, proposal, answer) => {
        const current = Object.freeze({
          consentimiento_decision: false,
          paciente_edad_texto: '0',
          diagnostico_texto: reviewed,
          paciente_telefono: null,
        });
        const next = mergeEmptyFormValues(current, {
          consentimiento_decision: answer,
          paciente_edad_texto: '99',
          diagnostico_texto: proposal,
          paciente_telefono: '000000',
        });
        expect(next).toEqual({ ...current, paciente_telefono: '000000' });
        expect(mergeEmptyFormValues(next, { diagnostico_texto: proposal })).toEqual(next);
        expect(current.paciente_telefono).toBeNull();
      }),
      checks
    );
  });

  it('round-trips passport identity without losing zeros or inventing a RUT', () => {
    const form = getClinicalForm('solicitud-serologia-hepatitis-chagas');
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999999 }), text, (number, name) => {
        const passport = `00P${number}`;
        let values: ClinicalFormValues = {
          paciente_nombre_completo: name,
          paciente_rut: '11.111.111-1',
        };
        values = setClinicalFormValue(values, 'paciente_documento_tipo', 'Pasaporte');
        values = setClinicalFormValue(values, 'paciente_documento_numero', passport);
        const restored = importClinicalFormDraft(exportClinicalFormDraft(form.id, values));
        expect(restored.values).toEqual(values);
        expect(restored.values.paciente_documento_numero).toBe(passport);
        expect(restored.values.paciente_rut).toBeNull();
        const printable = validateClinicalFormValues(form, restored.values, []);
        expect(printable.paciente_documento_numero).toBe(passport);
      }),
      checks
    );
  });

  it('keeps suppressed values blank and unvalidated in every template without changing the draft', () => {
    fc.assert(
      fc.property(fc.constantFrom(false, true, null, 'invalid\nvalue', '2026-02-30'), value => {
        for (const form of CLINICAL_FORMS) {
          const ids = form.fields.map(field => field.id);
          const values = Object.freeze(Object.fromEntries(ids.map(id => [id, value])));
          expect(validateClinicalFormValues(form, values, ids)).toEqual(
            Object.fromEntries(ids.map(id => [id, null]))
          );
          expect(Object.values(values).every(original => original === value)).toBe(true);
        }
      }),
      checks
    );
  });

  it('never replaces an answered MEDIF choice with a habitual answer, and repeated application is stable', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat(), { minLength: groups.length, maxLength: groups.length }),
        choices => {
          let values = emptyMedifValues();
          groups.forEach((group, index) => {
            const selected = choices[index] % (group.options.length + 1);
            if (selected < group.options.length)
              values = setMedifFieldValue(values, group.options[selected].fieldId, 'X');
          });
          const original = { ...values };
          const first = applyMedifHabitualAnswers(values, emptyMedifPreferences());
          for (const [id, value] of Object.entries(original)) {
            if (value) expect(first.values[id], id).toBe(value);
          }
          expect(values).toEqual(original);
          const second = applyMedifHabitualAnswers(first.values, emptyMedifPreferences());
          expect(second.values).toEqual(first.values);
          expect(second.applied).toBe(0);
          for (const group of groups) {
            if (!group.multiple)
              expect(
                group.options.filter(option => first.values[option.fieldId] === 'X').length
              ).toBeLessThanOrEqual(1);
          }
        }
      ),
      checks
    );
  });

  it('suppresses every alternative of hidden MEDIF choices regardless of the selected answer', () => {
    fc.assert(
      fc.property(fc.constantFrom(...groups), fc.nat(), (group, index) => {
        const selected = group.options[index % group.options.length].fieldId;
        const values = setMedifFieldValue(emptyMedifValues(), selected, 'X');
        const hidden = setMedifFieldHidden(emptyMedifPreferences(), group.options[0].fieldId, true);
        const exported = filterMedifExportValues(values, hidden);
        for (const option of group.options) expect(exported).not.toHaveProperty(option.fieldId);
        expect(values[selected]).toBe('X');
      }),
      checks
    );
  });
});
