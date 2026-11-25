import React from 'react';
import type {
  ClinicalFormDefinition,
  ClinicalFormField,
  ClinicalFormValue,
  ClinicalFormValues,
} from '../../../domain/forms/clinicalFormTypes';
import { ClinicalFormInput } from './ClinicalFormInput';
import { isSuppressedClinicalFormField } from '../../../domain/forms/clinicalFormFieldPolicy';
import {
  hasSicStructuredName,
  SIC_FORM_ID,
  SIC_STRUCTURED_NAME_IDS,
} from '../../../domain/forms/sicFormData';

interface Props {
  form: ClinicalFormDefinition;
  values: ClinicalFormValues;
  hidden: ReadonlyArray<string>;
  query: string;
  onChange: (id: string, value: ClinicalFormValue) => void;
}

export const matchesClinicalFormField = (field: ClinicalFormField, query: string) =>
  `${field.label} ${field.section} ${field.id} ${field.row ? `Registro ${field.row}` : ''}`
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .includes(
      query
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .trim()
    );

const Matrix: React.FC<{
  section: string;
  fields: ClinicalFormField[];
  values: ClinicalFormValues;
  onChange: Props['onChange'];
}> = ({ section, fields, values, onChange }) => {
  const rows = [...new Set(fields.map(field => field.row))];
  const columns = [...new Map(fields.map(field => [field.column, field])).values()];
  const lookup = new Map(fields.map(field => [`${field.row}:${field.column}`, field]));
  return (
    <div
      className="clinical-form-matrix-scroll"
      tabIndex={0}
      role="region"
      aria-label={`${section}: tabla desplazable`}
    >
      <table className="clinical-form-matrix">
        <thead>
          <tr>
            <th scope="col">Nº</th>
            {columns.map(field => (
              <th key={field.column} scope="col">
                {field.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row}>
              <th scope="row">{row}</th>
              {columns.map(column => {
                const field = lookup.get(`${row}:${column.column}`);
                return (
                  <td key={column.column}>
                    {field ? (
                      <ClinicalFormInput
                        field={field}
                        value={values[field.id]}
                        onChange={onChange}
                        matrix
                      />
                    ) : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const ClinicalFormFields: React.FC<Props> = ({ form, values, hidden, query, onChange }) => {
  const isSic = form.id === SIC_FORM_ID;
  const structuredSicName = isSic && hasSicStructuredName(values);
  const fields = form.fields.filter(field => {
    if (field.fixedValue !== undefined || isSuppressedClinicalFormField(field)) return false;
    if (hidden.includes(field.id) || !matchesClinicalFormField(field, query)) return false;
    if (isSic) {
      if (structuredSicName && field.id === 'paciente_nombre_completo') return false;
      if (
        !structuredSicName &&
        (SIC_STRUCTURED_NAME_IDS as ReadonlyArray<string>).includes(field.id)
      )
        return false;
    }
    return true;
  });
  const priority: Record<string, number> = {
    Paciente: 0,
    Solicitud: 1,
    Documento: 1,
    Registro: 2,
    Profesional: 100,
  };
  const sections = [...new Set(fields.map(field => field.section))].sort(
    (a, b) => (priority[a] ?? 10) - (priority[b] ?? 10)
  );
  if (!fields.length)
    return <p className="clinical-form-muted">No hay campos visibles para esta búsqueda.</p>;
  return (
    <div className="clinical-form-sections">
      {sections.map(section => {
        const items = fields.filter(field => field.section === section);
        return (
          <fieldset key={section} className="clinical-form-section">
            <legend>{section}</legend>
            {items[0]?.row ? (
              <Matrix section={section} fields={items} values={values} onChange={onChange} />
            ) : (
              <div
                className={`clinical-form-fields${items.filter(field => field.kind === 'check').length >= 2 ? ' clinical-form-fields--checks' : ''}`}
              >
                {section === 'Paciente' &&
                  items.some(field => field.id === 'paciente_documento_numero') && (
                    <label className="clinical-form-field">
                      Tipo de documento
                      <select
                        className="clinical-form-input"
                        aria-label="Tipo de documento"
                        value={
                          typeof values.paciente_documento_tipo === 'string'
                            ? values.paciente_documento_tipo
                            : ''
                        }
                        onChange={event => onChange('paciente_documento_tipo', event.target.value)}
                      >
                        <option value="">Sin indicar</option>
                        <option value="RUT">RUT</option>
                        <option value="Pasaporte">Pasaporte</option>
                      </select>
                    </label>
                  )}
                {items.map(field => (
                  <ClinicalFormInput
                    key={field.id}
                    field={field}
                    value={values[field.id]}
                    onChange={onChange}
                  />
                ))}
              </div>
            )}
          </fieldset>
        );
      })}
    </div>
  );
};
