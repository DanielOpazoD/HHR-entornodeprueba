import React from 'react';
import type { ClinicalFormField, ClinicalFormValue } from '../../../domain/forms/clinicalFormTypes';

export interface ClinicalFormInputProps {
  field: ClinicalFormField;
  value: ClinicalFormValue | undefined;
  onChange: (id: string, value: ClinicalFormValue) => void;
  matrix?: boolean;
}

export const ClinicalFormInput: React.FC<ClinicalFormInputProps> = ({
  field,
  value,
  onChange,
  matrix,
}) => {
  const id = `clinical-form-${field.id}`;
  const label = field.row ? `Registro ${field.row} · ${field.label}` : field.label;
  if (field.kind === 'check')
    return (
      <label className="clinical-form-check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={event => onChange(field.id, event.target.checked)}
        />
        <span>{field.label}</span>
      </label>
    );
  if (field.kind === 'boolean')
    return (
      <fieldset className="clinical-form-answer">
        <legend>{field.label}</legend>
        <div role="group" aria-label={field.label} className="clinical-form-segmented">
          {(
            [
              { label: '—', value: null },
              { label: 'Sí', value: true },
              { label: 'No', value: false },
            ] as const
          ).map(option => (
            <button
              key={String(option.value)}
              type="button"
              aria-label={`${field.label}: ${option.value === null ? 'sin respuesta' : option.label}`}
              aria-pressed={(value ?? null) === option.value}
              onClick={() => onChange(field.id, option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
    );
  const inputProps = {
    id,
    'aria-label': label,
    value: typeof value === 'string' ? value : '',
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ) => onChange(field.id, event.target.value),
    className: 'clinical-form-input',
  };
  const control =
    field.kind === 'choice' ? (
      <select {...inputProps}>
        <option value="">Sin completar</option>
        {field.options?.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ) : field.multiline ? (
      <textarea {...inputProps} rows={2} maxLength={12_000} />
    ) : (
      <input
        {...inputProps}
        type={field.kind === 'date' ? 'date' : field.kind === 'time' ? 'time' : 'text'}
        onInput={
          field.kind === 'date' || field.kind === 'time'
            ? event => onChange(field.id, event.currentTarget.value)
            : undefined
        }
        maxLength={12_000}
        autoComplete="off"
      />
    );
  return (
    <label
      htmlFor={id}
      className={`clinical-form-field${field.multiline ? ' clinical-form-field-wide' : ''}`}
    >
      <span className={matrix ? 'sr-only' : ''}>{field.label}</span>
      {control}
    </label>
  );
};
