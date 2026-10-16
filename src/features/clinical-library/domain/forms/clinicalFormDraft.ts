import { isClinicalFormRut } from './clinicalFormIdentity';
import {
  CLINICAL_FORMS,
  CLINICAL_VARIABLE_CATALOG,
  CLINICAL_VARIABLE_IDS,
  getClinicalForm,
} from './clinicalFormCatalog';
import { parseFormDate } from './clinicalFormDates';
import { isEmptyFormValue } from './clinicalFormPatient';
import type {
  ClinicalFormDefinition,
  ClinicalFormId,
  ClinicalFormValues,
  ClinicalFormValue,
} from './clinicalFormTypes';

const MAX_TEXT_LENGTH = 12_000;
const fieldsById = new Map(
  CLINICAL_FORMS.flatMap(form => form.fields.map(field => [field.id, field] as const))
);

export const hasClinicalFormData = (values: ClinicalFormValues): boolean =>
  Object.entries(values).some(
    ([id, value]) => fieldsById.has(id.split('::').at(-1) ?? id) && !isEmptyFormValue(value)
  );

// Emission dates belong to each document, while patient and episode facts are shared.
const documentVariable = 'formulario_fecha_emision';
export const storedClinicalFormValues = (
  formId: ClinicalFormId,
  values: ClinicalFormValues
): ClinicalFormValues => {
  const next = { ...values };
  if (Object.hasOwn(next, documentVariable)) {
    next[`${formId}::${documentVariable}`] = next[documentVariable];
    delete next[documentVariable];
  }
  return next;
};
export const projectedClinicalFormValues = (
  formId: ClinicalFormId,
  values: ClinicalFormValues
): ClinicalFormValues => ({
  ...Object.fromEntries(Object.entries(values).filter(([id]) => !id.includes('::'))),
  [documentVariable]: values[`${formId}::${documentVariable}`] ?? null,
});
export const storedClinicalFormVariableId = (formId: ClinicalFormId, id: string): string =>
  id === documentVariable ? `${formId}::${id}` : id;

export const setClinicalFormValue = (
  values: ClinicalFormValues,
  id: string,
  value: ClinicalFormValue
): ClinicalFormValues => {
  const next = { ...values, [id]: value };
  // These aliases refer to the same personal document, not to a maternal document.
  if (id === 'paciente_rut') {
    next.paciente_documento_tipo = 'RUT';
    next.paciente_documento_numero = value;
  } else if (id === 'paciente_documento_numero') {
    next.paciente_rut =
      typeof value === 'string' &&
      isClinicalFormRut(value) &&
      values.paciente_documento_tipo === 'RUT'
        ? value
        : null;
  } else if (id === 'paciente_documento_tipo') {
    const document = values.paciente_documento_numero;
    next.paciente_rut =
      value === 'RUT' && typeof document === 'string' && isClinicalFormRut(document)
        ? document
        : null;
  }
  return next;
};

/** Export an explicit local draft. Preferences have a different, values-free schema. */
export const exportClinicalFormDraft = (
  formId: ClinicalFormId,
  values: ClinicalFormValues
): string =>
  JSON.stringify(
    {
      kind: 'hhr-clinical-form-draft',
      version: 1,
      formId,
      values: Object.fromEntries(
        Object.entries(values).filter(
          ([id]) =>
            CLINICAL_VARIABLE_IDS.has(id) ||
            getClinicalForm(formId).fields.some(field => field.id === id)
        )
      ),
    },
    null,
    2
  );

export const importClinicalFormDraft = (
  text: string
): { formId: ClinicalFormId; values: ClinicalFormValues } => {
  const input: unknown = JSON.parse(text);
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Borrador no válido.');
  const data = input as Record<string, unknown>;
  if (
    data.kind !== 'hhr-clinical-form-draft' ||
    data.version !== 1 ||
    typeof data.formId !== 'string' ||
    !CLINICAL_FORMS.some(form => form.id === data.formId) ||
    !data.values ||
    typeof data.values !== 'object' ||
    Array.isArray(data.values)
  ) {
    throw new Error('Este archivo no es un borrador de formularios clínicos compatible.');
  }
  const values: ClinicalFormValues = {};
  for (const [id, value] of Object.entries(data.values)) {
    if (!fieldsById.has(id) && !CLINICAL_VARIABLE_IDS.has(id))
      throw new Error('El borrador contiene variables desconocidas.');
    if (value !== null && typeof value !== 'string' && typeof value !== 'boolean')
      throw new Error('Valor de borrador no válido.');
    if (typeof value === 'string' && value.length > MAX_TEXT_LENGTH)
      throw new Error('Un texto del borrador es demasiado largo.');
    values[id] = value;
  }
  for (const variable of CLINICAL_VARIABLE_CATALOG.variables) {
    const value = values[variable.id];
    if (isEmptyFormValue(value)) continue;
    if (
      typeof value !== 'string' ||
      (variable.type === 'date' && !parseFormDate(value)) ||
      ('options' in variable &&
        Array.isArray(variable.options) &&
        !variable.options.includes(value))
    ) {
      throw new Error(`Revisa el tipo de «${variable.label}» en el borrador.`);
    }
  }
  // Drafts can retain a partially entered RUT; full identity validation runs before printing.
  CLINICAL_FORMS.forEach(form => validateClinicalFormValues(form, values, [], false));
  const rut = values.paciente_rut;
  if (
    !isEmptyFormValue(rut) &&
    !isEmptyFormValue(values.paciente_documento_numero) &&
    (values.paciente_documento_tipo === 'Pasaporte' ||
      String(rut)
        .replace(/[.\s-]/g, '')
        .toUpperCase() !==
        String(values.paciente_documento_numero)
          .replace(/[.\s-]/g, '')
          .toUpperCase())
  ) {
    throw new Error(
      'El RUT y el documento del borrador no coinciden. Revisa el archivo antes de importarlo.'
    );
  }
  return { formId: getClinicalForm(data.formId as ClinicalFormId).id, values };
};

/** Suppressed variables are deliberately blank and do not block printing. */
export const validateClinicalFormValues = (
  form: ClinicalFormDefinition,
  input: ClinicalFormValues,
  hidden: ReadonlyArray<string>,
  validateIdentity = true
): ClinicalFormValues => {
  const values: ClinicalFormValues = {};
  for (const field of form.fields) {
    const value = hidden.includes(field.id) ? null : (input[field.id] ?? null);
    if (isEmptyFormValue(value)) {
      values[field.id] = null;
      continue;
    }
    const invalid = () => new Error(`Revisa «${field.label}».`);
    if (field.kind === 'boolean' || field.kind === 'check') {
      if (typeof value !== 'boolean') throw invalid();
    } else {
      if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) throw invalid();
      if (field.kind === 'date' && !parseFormDate(value)) throw invalid();
      if (field.kind === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw invalid();
      if (field.kind === 'choice' && !field.options?.some(option => option.value === value))
        throw invalid();
      if (validateIdentity && (field.id === 'paciente_rut' || field.id === 'medico_tratante_rut')) {
        if (!isClinicalFormRut(value))
          throw new Error(
            `El RUT en «${field.label}» no es válido; comprueba el número y su dígito verificador.`
          );
      }
      if (!field.multiline && /[\r\n]/.test(value))
        throw new Error(`«${field.label}» admite una sola línea.`);
    }
    values[field.id] = value;
  }
  return values;
};
