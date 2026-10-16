import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { MEDIF_FIELDS, MEDIF_SECTIONS } from '../../../domain/medifSchema';
import { isMedifFieldHidden, type MedifPreferences } from '../../../domain/medifPreferences';
import { TOOL_INPUT_CLASS } from '../ToolField';

export const MedifVariableIndex: React.FC<{
  preferences: MedifPreferences;
  onSelectField: (fieldId: string) => void;
}> = ({ preferences, onSelectField }) => {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLocaleLowerCase('es');
  const filtered = MEDIF_FIELDS.filter(field =>
    `${field.id} ${field.label} ${field.shortLabel}`
      .toLocaleLowerCase('es')
      .includes(normalizedQuery)
  );
  return (
    <section aria-label="Índice de variables MEDIF">
      <h4 className="mb-2 text-sm font-bold text-slate-800">Diccionario de variables</h4>
      <label className="mb-3 block text-[11px] font-semibold text-slate-600">
        Buscar variable
        <span className="relative mt-1 block">
          <Search
            size={15}
            aria-hidden="true"
            className="medif-variable-search-icon absolute left-2.5 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            className={`${TOOL_INPUT_CLASS} pl-8`}
            placeholder="Nombre, identificador o pregunta del PDF"
          />
        </span>
      </label>
      <p role="status" className="mb-2 text-[10px] text-slate-500">
        {filtered.length} variables
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-[11px]">
          <caption className="sr-only">
            Variables del formulario MEDIF, tipo, página y visibilidad
          </caption>
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-3 py-2">
                Variable / casillero
              </th>
              <th scope="col" className="px-3 py-2">
                Tipo
              </th>
              <th scope="col" className="px-3 py-2">
                Página
              </th>
              <th scope="col" className="px-3 py-2">
                Estado
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filtered.map(field => (
              <tr key={field.id} className="align-top hover:bg-slate-50">
                <td className="px-3 py-3">
                  <button
                    type="button"
                    onClick={() => onSelectField(field.id)}
                    className="text-left font-semibold text-medical-700 hover:underline focus-visible:outline focus-visible:outline-medical-600"
                  >
                    {field.label}
                  </button>
                  <code className="mt-1 block break-all text-[10px] text-slate-400">
                    {field.id}
                  </code>
                  <span className="mt-1 block text-[10px] text-slate-500">
                    {MEDIF_SECTIONS.find(section => section.id === field.sectionId)?.title}
                    {field.suggestedSource === 'hhr' ? ' · Propuesta desde el censo' : ''}
                  </span>
                  {field.help && (
                    <p className="mt-1 max-w-lg leading-relaxed text-slate-500">{field.help}</p>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                  {field.kind === 'mark' ? 'Marca X' : field.multiline ? 'Texto libre' : 'Texto'}
                </td>
                <td className="px-3 py-3 tabular-nums text-slate-600">{field.page}</td>
                <td className="px-3 py-3">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${isMedifFieldHidden(preferences, field.id) ? 'bg-slate-100 text-slate-500' : 'bg-medical-50 text-medical-700'}`}
                  >
                    {isMedifFieldHidden(preferences, field.id) ? 'Oculto' : 'Visible'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
