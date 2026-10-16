import React from 'react';
import type {
  ClinicalFormDefinition,
  ClinicalFormField,
  ClinicalFormValue,
  ClinicalFormValues,
} from '../../../domain/forms/clinicalFormTypes';
import { ClinicalFormInput } from './ClinicalFormInput';

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
  fields: ClinicalFormField[];
  values: ClinicalFormValues;
  onChange: Props['onChange'];
}> = ({ fields, values, onChange }) => {
  const rows = [...new Set(fields.map(field => field.row))];
  const columns = [...new Map(fields.map(field => [field.column, field])).values()];
  const lookup = new Map(fields.map(field => [`${field.row}:${field.column}`, field]));
  return (
    <div
      className="clinical-form-matrix-scroll"
      tabIndex={0}
      role="region"
      aria-label="Registros ventilatorios: tabla desplazable"
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
  const fields = form.fields.filter(
    field => !hidden.includes(field.id) && matchesClinicalFormField(field, query)
  );
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
            {items[0].row ? (
              <Matrix fields={items} values={values} onChange={onChange} />
            ) : (
              <div className="clinical-form-fields">
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
