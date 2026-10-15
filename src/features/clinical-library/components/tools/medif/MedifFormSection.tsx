import React from 'react';
import { EyeOff, FileText } from 'lucide-react';
import {
  MEDIF_FIELD_BY_ID,
  getMedifGroupFieldIds,
  type MedifField,
  type MedifSection,
} from '../../../domain/medifSchema';
import type { MedifValues } from '../../../domain/medifDraft';
import { isMedifFieldHidden, type MedifPreferences } from '../../../domain/medifPreferences';
import { TOOL_INPUT_CLASS } from '../ToolField';

interface Props {
  section: MedifSection;
  values: MedifValues;
  preferences: MedifPreferences;
  onChange: (id: string, value: string) => void;
  onPreferences: () => void;
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: MedifField;
  value: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  const id = `medif-${field.id}`;
  const linked = field.id === 'p2_nombre_paciente' || field.id === 'p2_edad';
  const props = {
    id,
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(event.target.value),
    placeholder: field.placeholder,
    autoComplete: 'off',
    'aria-describedby': linked || field.help ? `${id}-help` : undefined,
  };
  return (
    <div className={field.multiline ? 'sm:col-span-2' : ''}>
      <label
        htmlFor={id}
        className="mb-1.5 flex items-center justify-between gap-2 text-[12px] font-semibold text-slate-700"
      >
        {field.shortLabel}
        <span className="shrink-0 text-[9px] font-normal text-slate-400">Pág. {field.page}</span>
      </label>
      {field.multiline ? (
        <textarea
          {...props}
          rows={3}
          className={`${TOOL_INPUT_CLASS} h-auto min-h-20 resize-y py-2 leading-relaxed`}
        />
      ) : (
        <input {...props} type="text" className={TOOL_INPUT_CLASS} />
      )}
      {(linked || field.help) && (
        <p id={`${id}-help`} className="mt-1 text-[10px] leading-relaxed text-slate-500">
          {linked ? 'Se actualiza junto con el mismo dato de la página 1.' : field.help}
        </p>
      )}
    </div>
  );
}

export const MedifFormSection: React.FC<Props> = ({
  section,
  values,
  preferences,
  onChange,
  onPreferences,
}) => {
  const visibleGroups = section.groups.filter(group =>
    getMedifGroupFieldIds(group).some(id => !isMedifFieldHidden(preferences, id))
  );
  const hiddenCount = section.groups
    .flatMap(getMedifGroupFieldIds)
    .filter(id => isMedifFieldHidden(preferences, id)).length;
  return (
    <section aria-labelledby={`medif-section-${section.id}`}>
      <div className="mb-4">
        <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-medical-600">
          <FileText size={12} aria-hidden="true" /> Formulario MEDIF
        </p>
        <h4 id={`medif-section-${section.id}`} className="text-lg font-bold text-slate-800">
          {section.title}
        </h4>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{section.description}</p>
      </div>
      <div className="space-y-3">
        {visibleGroups.map(group => (
          <fieldset
            key={group.id}
            className="min-w-0 rounded-lg border border-slate-200 bg-white px-4 pb-4 pt-2"
          >
            <legend className="px-1 text-[12px] font-bold text-slate-700">{group.label}</legend>
            {group.help && (
              <p className="mb-3 text-[11px] leading-relaxed text-slate-500">{group.help}</p>
            )}
            {group.type === 'choice' ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {group.options.map(option => (
                  <label
                    key={option.fieldId}
                    className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-[12px] ${values[option.fieldId] === 'X' ? 'border-medical-300 bg-medical-50 font-semibold text-medical-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    <input
                      type={group.multiple ? 'checkbox' : 'radio'}
                      name={`medif-choice-${group.id}`}
                      checked={values[option.fieldId] === 'X'}
                      onChange={event => onChange(option.fieldId, event.target.checked ? 'X' : '')}
                      className="size-3.5 accent-medical-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-medical-600"
                    />
                    {option.label}
                  </label>
                ))}
                {group.options.some(option => values[option.fieldId] === 'X') && (
                  <button
                    type="button"
                    className="ml-auto rounded px-2 py-1 text-[10px] font-medium text-slate-500 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-medical-600"
                    onClick={() => group.options.forEach(option => onChange(option.fieldId, ''))}
                  >
                    Limpiar respuesta
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 pt-1 sm:grid-cols-2">
                {group.fields
                  .filter(id => !isMedifFieldHidden(preferences, id))
                  .map(id => (
                    <FieldInput
                      key={id}
                      field={MEDIF_FIELD_BY_ID[id]}
                      value={values[id] ?? ''}
                      onChange={value => onChange(id, value)}
                    />
                  ))}
              </div>
            )}
          </fieldset>
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={onPreferences}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-[11px] text-slate-500 hover:border-medical-400 hover:text-medical-700 focus-visible:outline focus-visible:outline-medical-600"
          >
            <EyeOff size={14} aria-hidden="true" /> {hiddenCount} casilleros ocultos. Administrar en
            preferencias
          </button>
        )}
      </div>
    </section>
  );
};
