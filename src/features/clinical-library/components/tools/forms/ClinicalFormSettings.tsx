import React, { useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { CLINICAL_VARIABLE_CATALOG } from '../../../domain/forms/clinicalFormCatalog';
import {
  parseClinicalFormPreferences,
  serializeClinicalFormPreferences,
  type ClinicalFormPreferences,
} from '../../../domain/forms/clinicalFormPreferences';
import type { ClinicalFormDefinition } from '../../../domain/forms/clinicalFormTypes';
import { matchesClinicalFormField } from './ClinicalFormFields';
import { isSuppressedClinicalFormField } from '../../../domain/forms/clinicalFormFieldPolicy';

export const downloadClinicalFormJson = (text: string, name: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
};

interface Props {
  form: ClinicalFormDefinition;
  preferences: ClinicalFormPreferences;
  onChange: (next: ClinicalFormPreferences) => void;
  onNotice: (message: string) => void;
}

export const ClinicalFormSettings: React.FC<Props> = ({
  form,
  preferences,
  onChange,
  onNotice,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current += 1;
    },
    []
  );
  const visible = form.fields.filter(
    field => !isSuppressedClinicalFormField(field) && matchesClinicalFormField(field, query)
  );
  const importFile = async (file?: File) => {
    if (!file) return;
    const attempt = ++sequence.current;
    try {
      if (file.size > 100_000) throw new Error('El archivo de preferencias es demasiado grande.');
      const text = await file.text().catch(() => {
        throw new Error('No se pudo leer el archivo de preferencias. Vuelve a intentarlo.');
      });
      if (attempt === sequence.current) onChange(parseClinicalFormPreferences(text, form));
    } catch (error) {
      if (attempt === sequence.current)
        onNotice(
          error instanceof Error ? error.message : 'No se pudieron importar las preferencias.'
        );
    }
  };
  return (
    <section aria-label="Variables y preferencias" className="clinical-form-settings">
      <div className="clinical-form-toolbar">
        <input
          aria-label="Buscar variable"
          placeholder="Buscar variable…"
          value={query}
          onChange={event => setQuery(event.target.value)}
          className="clinical-form-input clinical-form-search"
        />
        <button
          type="button"
          className="clinical-form-icon"
          title="Exportar preferencias"
          aria-label="Exportar preferencias"
          onClick={() =>
            downloadClinicalFormJson(
              serializeClinicalFormPreferences(preferences),
              `${form.id}-preferencias.json`
            )
          }
        >
          <Download size={16} />
        </button>
        <button
          type="button"
          className="clinical-form-icon"
          title="Importar preferencias"
          aria-label="Importar preferencias"
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={16} />
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          aria-label="Archivo de preferencias del formulario"
          className="hidden"
          onChange={event => {
            void importFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      <p className="clinical-form-muted">Los campos ocultos se imprimen vacíos.</p>
      <div className="clinical-form-variable-list">
        {visible.map(field => {
          const common = CLINICAL_VARIABLE_CATALOG.variables.find(
            variable => variable.id === field.id
          );
          return (
            <label key={field.id} className="clinical-form-variable">
              <input
                type="checkbox"
                aria-label={`Mostrar ${field.row ? `Registro ${field.row} · ` : ''}${field.label}`}
                checked={!preferences.hidden.includes(field.id)}
                onChange={event => {
                  sequence.current += 1;
                  onChange({
                    ...preferences,
                    hidden: event.target.checked
                      ? preferences.hidden.filter(id => id !== field.id)
                      : [...preferences.hidden, field.id],
                  });
                }}
              />
              <span>
                <strong>
                  {field.row ? `Registro ${field.row} · ` : ''}
                  {field.label}
                </strong>
                <code>{field.id}</code>
                {common && (
                  <small>{common.hhrPath ? `Censo: ${common.hhrPath}` : 'Entrada manual'}</small>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
};
