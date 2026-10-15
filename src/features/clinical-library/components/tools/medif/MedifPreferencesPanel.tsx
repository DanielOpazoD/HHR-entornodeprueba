import React, { useEffect, useRef, useState } from 'react';
import { Download, Eye, EyeOff, Upload } from 'lucide-react';
import {
  MEDIF_FIELD_BY_ID,
  MEDIF_SECTIONS,
  getMedifGroupFieldIds,
} from '../../../domain/medifSchema';
import {
  emptyMedifPreferences,
  exportMedifPreferences,
  importMedifPreferences,
  isMedifFieldHidden,
  setMedifFieldHidden,
  type MedifPreferences,
} from '../../../domain/medifPreferences';
import { TOOL_INPUT_CLASS } from '../ToolField';
import { downloadMedifJson, MEDIF_SECONDARY_BUTTON } from './medifEditorTypes';

interface Props {
  preferences: MedifPreferences;
  onChange: (preferences: MedifPreferences) => void;
  saved: boolean | null;
}

export const MedifPreferencesPanel: React.FC<Props> = ({ preferences, onChange, saved }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const importGeneration = useRef(0);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase('es');
  useEffect(
    () => () => {
      importGeneration.current += 1;
    },
    []
  );
  const updatePreferences = (next: MedifPreferences): void => {
    importGeneration.current += 1;
    setNotice('');
    onChange(next);
  };
  const importFile = async (file?: File): Promise<void> => {
    if (!file) return;
    const generation = ++importGeneration.current;
    try {
      if (file.size > 100_000) throw new Error('El archivo de preferencias es demasiado grande.');
      const text = await file.text();
      if (generation !== importGeneration.current) return;
      onChange(importMedifPreferences(text));
      setNotice('Preferencias importadas.');
    } catch (error) {
      if (generation !== importGeneration.current) return;
      setNotice(
        error instanceof Error ? error.message : 'No se pudieron importar las preferencias.'
      );
    }
  };

  return (
    <section aria-label="Preferencias MEDIF" className="space-y-4">
      <div className="rounded-lg border border-medical-200 bg-medical-50 p-4">
        <h4 className="text-[14px] font-bold text-medical-900">Tu configuración de campos</h4>
        <p className="mt-1 text-[12px] leading-relaxed text-medical-800">
          Oculta las variables que no utilizas y vuelve a habilitarlas cuando las necesites. Los
          casilleros ocultos se dejan en blanco en el PDF, aunque hayas escrito un valor.
        </p>
        <p className="mt-2 text-[11px] text-medical-700">
          Se guarda en este navegador. La configuración exportada contiene solo preferencias de
          visibilidad.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={MEDIF_SECONDARY_BUTTON}
          onClick={() =>
            downloadMedifJson(exportMedifPreferences(preferences), 'medif-preferencias.json')
          }
        >
          <Download size={13} aria-hidden="true" /> Exportar preferencias
        </button>
        <button
          type="button"
          className={MEDIF_SECONDARY_BUTTON}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={13} aria-hidden="true" /> Importar preferencias
        </button>
        <button
          type="button"
          className={MEDIF_SECONDARY_BUTTON}
          onClick={() => updatePreferences(emptyMedifPreferences())}
        >
          <Eye size={13} aria-hidden="true" /> Mostrar todos
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          aria-label="Archivo de preferencias"
          className="hidden"
          onChange={event => {
            void importFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="flex items-center gap-1.5 text-slate-500">
          <EyeOff size={13} aria-hidden="true" /> {preferences.hiddenFieldIds.length} de 137
          casilleros ocultos
        </span>
        <span role="status" className={saved === false ? 'text-amber-700' : 'text-emerald-700'}>
          {saved === null
            ? 'Configuración activa'
            : saved
              ? 'Preferencias guardadas'
              : 'No se pudo guardar en el navegador; puedes exportarlas.'}
        </span>
      </div>
      {notice && (
        <p role="status" className="rounded-md bg-slate-100 px-3 py-2 text-[12px] text-slate-700">
          {notice}
        </p>
      )}
      <label className="block text-[11px] font-semibold text-slate-600">
        Buscar campo o sección
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          className={`${TOOL_INPUT_CLASS} mt-1`}
          placeholder="Ej. oxígeno, seguro, firma…"
        />
      </label>
      <div className="space-y-3">
        {MEDIF_SECTIONS.map(section => {
          const rows = section.groups
            .flatMap(group =>
              group.type === 'choice'
                ? [
                    {
                      id: getMedifGroupFieldIds(group)[0],
                      label: group.label,
                      count: getMedifGroupFieldIds(group).length,
                    },
                  ]
                : group.fields.map(id => ({
                    id,
                    label: MEDIF_FIELD_BY_ID[id].shortLabel,
                    count: 1,
                  }))
            )
            .filter(row =>
              `${section.title} ${row.label} ${row.id}`
                .toLocaleLowerCase('es')
                .includes(normalizedQuery)
            );
          if (!rows.length) return null;
          return (
            <fieldset
              key={section.id}
              className="rounded-lg border border-slate-200 bg-white px-3 pb-1"
            >
              <legend className="px-1 text-[12px] font-bold text-slate-700">{section.title}</legend>
              <div className="divide-y divide-slate-100">
                {rows.map(row => {
                  const visible = !isMedifFieldHidden(preferences, row.id);
                  return (
                    <label key={row.id} className="flex cursor-pointer items-center gap-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={event =>
                          updatePreferences(
                            setMedifFieldHidden(preferences, row.id, !event.target.checked)
                          )
                        }
                        className="size-4 shrink-0 accent-medical-600 focus-visible:outline focus-visible:outline-medical-600"
                      />
                      <span className="min-w-0 flex-1 text-[12px] text-slate-700">
                        {row.label}
                        {row.count > 1 && (
                          <span className="ml-1 text-[10px] text-slate-400">
                            ({row.count} casilleros)
                          </span>
                        )}
                      </span>
                      <span
                        className={`text-[10px] font-medium ${visible ? 'text-medical-600' : 'text-slate-400'}`}
                      >
                        {visible ? 'Visible' : 'Oculto'}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        Las opciones de una misma pregunta se ocultan juntas. Los nombres y edades repetidos entre
        las páginas 1 y 2 comparten visibilidad y valor.
      </p>
    </section>
  );
};
