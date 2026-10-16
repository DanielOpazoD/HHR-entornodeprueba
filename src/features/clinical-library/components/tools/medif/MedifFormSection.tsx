import React from 'react';
import {
  MEDIF_FIELD_BY_ID,
  getMedifGroupFieldIds,
  type MedifField,
  type MedifGroup,
} from '../../../domain/medifSchema';
import {
  MEDIF_DUPLICATE_FIELD_IDS,
  getMedifFormBlockGroups,
  getMedifFormGroupLabel,
  type MedifFormBlock,
} from '../../../domain/medifFormLayout';
import type { MedifValues } from '../../../domain/medifDraft';
import { isMedifFieldHidden, type MedifPreferences } from '../../../domain/medifPreferences';

interface Props {
  block: MedifFormBlock;
  values: MedifValues;
  preferences: MedifPreferences;
  onChange: (id: string, value: string) => void;
  onPreferences: () => void;
}

function FieldInput({
  field,
  value,
  onChange,
  label,
}: {
  field: MedifField;
  label?: string;
  value: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  const id = `medif-${field.id}`;
  const props = {
    id,
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(event.target.value),
    placeholder: field.placeholder,
    title: field.help,
    autoComplete: 'off',
  };
  return (
    <div
      className={`medif-field${field.multiline || ['p1_seguro_viaje', 'p2_nombre_medico', 'p3_firma_medico_texto', 'p1_declaracion_firma'].includes(field.id) ? ' medif-field--full' : ''}${field.id === 'p1_nombre_pasajero' ? ' medif-field--name' : ''}`}
    >
      <label htmlFor={id}>{label ?? field.shortLabel}</label>
      {field.multiline ? (
        <textarea {...props} rows={2} className="medif-input medif-textarea" />
      ) : (
        <input {...props} type="text" className="medif-input" />
      )}
    </div>
  );
}

export const MedifFormSection: React.FC<Props> = ({
  block,
  values,
  preferences,
  onChange,
  onPreferences,
}) => {
  const sourceGroups = getMedifFormBlockGroups(block);
  const hiddenCount = sourceGroups
    .flatMap(getMedifGroupFieldIds)
    .filter(id => isMedifFieldHidden(preferences, id)).length;
  const groups: MedifGroup[] = sourceGroups
    .filter(group => group.id !== 'identificacion_medica')
    .map(
      (group): MedifGroup =>
        group.id === 'pasajero_datos'
          ? {
              ...group,
              type: 'fields',
              fields: ['p1_nombre_pasajero', 'p1_edad', 'p2_genero', 'p1_seguro_viaje'],
            }
          : group
    )
    .map(group =>
      group.type === 'fields'
        ? { ...group, fields: group.fields.filter(id => !MEDIF_DUPLICATE_FIELD_IDS.includes(id)) }
        : group
    );
  const visibleGroups = groups.filter(group =>
    getMedifGroupFieldIds(group).some(id => !isMedifFieldHidden(preferences, id))
  );
  return (
    <section
      id={`medif-block-${block.id}`}
      tabIndex={-1}
      aria-labelledby={`medif-heading-${block.id}`}
      className={`medif-card${block.fullWidth ? ' medif-card--wide' : ''}`}
    >
      <div className="medif-card-header">
        <h4 id={`medif-heading-${block.id}`}>{block.title}</h4>
        {hiddenCount > 0 && (
          <button type="button" className="medif-hidden-link" onClick={onPreferences}>
            {hiddenCount} ocultos · Preferencias
          </button>
        )}
      </div>
      {block.id === 'paciente_vuelo' && (
        <p className="medif-identity-note">
          Nombre y edad se completan una sola vez y se copian a las páginas 1 y 2.
        </p>
      )}
      {block.id === 'medico_declaraciones' && (
        <p className="medif-identity-note">
          El nombre del médico se completa una sola vez y se copia en ambas declaraciones.
        </p>
      )}
      <div className="medif-groups">
        {visibleGroups.map(group => {
          const label = getMedifFormGroupLabel(group);
          if (group.type === 'choice') {
            const answered = group.options.some(option => values[option.fieldId] === 'X');
            return (
              <fieldset
                key={group.id}
                className={`medif-choice${group.options.length > 2 ? ' medif-choice--many' : ''}`}
              >
                <legend className="sr-only">{label}</legend>
                <div className="medif-choice-row">
                  <span aria-hidden="true" className="medif-choice-label">
                    {label}
                  </span>
                  <div className="medif-choice-options">
                    {group.options.map(option => (
                      <label
                        key={option.fieldId}
                        className={`medif-option${values[option.fieldId] === 'X' ? ' medif-option--selected' : ''}`}
                      >
                        <input
                          id={`medif-${option.fieldId}`}
                          type={group.multiple ? 'checkbox' : 'radio'}
                          name={`medif-choice-${group.id}`}
                          checked={values[option.fieldId] === 'X'}
                          onChange={event =>
                            onChange(option.fieldId, event.target.checked ? 'X' : '')
                          }
                        />
                        {option.label}
                      </label>
                    ))}
                    <button
                      type="button"
                      className="medif-clear-choice"
                      disabled={!answered}
                      aria-label={`Limpiar respuesta: ${label}`}
                      title="Dejar sin respuesta"
                      onClick={() => group.options.forEach(option => onChange(option.fieldId, ''))}
                    >
                      ×
                    </button>
                  </div>
                </div>
                {group.help && <p className="medif-help">{group.help}</p>}
              </fieldset>
            );
          }
          return (
            <fieldset key={group.id} className={`medif-field-group medif-group-${group.id}`}>
              <legend className={group.fields.length === 1 ? 'sr-only' : 'medif-group-label'}>
                {label}
              </legend>
              {group.help && <p className="medif-help">{group.help}</p>}
              <div
                className={`medif-fields${group.fields.length === 1 ? ' medif-fields--single' : ''}${group.id === 'pasajero_datos' ? ' medif-fields--identity' : ''}${['medicacion_lista', 'antecedentes', 'acompanante_datos', 'tramo_1', 'tramo_2'].includes(group.id) ? ' medif-fields--three' : ''}`}
              >
                {group.fields
                  .filter(id => !isMedifFieldHidden(preferences, id))
                  .map(id => (
                    <FieldInput
                      key={id}
                      field={MEDIF_FIELD_BY_ID[id]}
                      label={group.fields.length === 1 ? label : undefined}
                      value={values[id] ?? ''}
                      onChange={value => onChange(id, value)}
                    />
                  ))}
              </div>
            </fieldset>
          );
        })}
      </div>
      {!visibleGroups.length && (
        <p className="medif-help">
          Todos los campos de este bloque están ocultos. Puedes habilitarlos en Preferencias.
        </p>
      )}
    </section>
  );
};
