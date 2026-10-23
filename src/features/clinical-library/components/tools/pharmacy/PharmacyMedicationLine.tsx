import React, { useId, useMemo, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { searchPharmacyArsenal } from '../../../domain/pharmacy/pharmacyDraft';
import type {
  ArsenalItem,
  PharmacyActKind,
  PharmacyActLine,
} from '../../../domain/pharmacy/pharmacyTypes';
import { TOOL_INPUT_CLASS, TextField } from '../ToolField';

interface PharmacyMedicationLineProps {
  line: PharmacyActLine;
  index: number;
  kind: PharmacyActKind;
  arsenal: ReadonlyArray<ArsenalItem>;
  canRemove: boolean;
  onChange: (next: PharmacyActLine) => void;
  onRemove: () => void;
}

export const PharmacyMedicationLine: React.FC<PharmacyMedicationLineProps> = ({
  line,
  index,
  kind,
  arsenal,
  canRemove,
  onChange,
  onRemove,
}) => {
  const id = useId();
  const [query, setQuery] = useState('');
  const matches = useMemo(
    () => (query.trim() ? searchPharmacyArsenal(arsenal, query) : []),
    [arsenal, query]
  );
  const manual = line.medicationId === 'manual';
  const selected = Boolean(line.medicationId) && !manual;
  const change = <K extends keyof PharmacyActLine>(key: K, value: PharmacyActLine[K]): void =>
    onChange({ ...line, [key]: value });
  const resetSelection = (): void => {
    setQuery('');
    onChange({ ...line, medicationId: '', name: '', presentation: '' });
  };

  return (
    <fieldset className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
      <legend className="px-1 text-xs font-bold text-slate-700">Registro {index + 1}</legend>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-500">
          {manual ? 'Ingreso fuera del arsenal' : 'Selección del arsenal HHR'}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Eliminar registro ${index + 1}`}
            className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-medical-600"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {selected ? (
        <div className="mb-3 rounded-md border border-medical-200 bg-medical-50 p-2.5">
          <p className="break-words text-xs font-semibold text-slate-800">{line.name}</p>
          <p className="mt-1 text-[11px] text-slate-600">Presentación: {line.presentation}</p>
          <button
            type="button"
            onClick={resetSelection}
            className="mt-2 text-[11px] font-semibold text-medical-700 underline underline-offset-2"
          >
            Cambiar selección
          </button>
        </div>
      ) : manual ? (
        <div className="mb-3 grid gap-3">
          <label className="text-[11px] font-semibold text-slate-600">
            Nombre del fármaco o insumo
            <input
              className={`${TOOL_INPUT_CLASS} mt-1`}
              value={line.name}
              maxLength={300}
              autoComplete="off"
              onChange={event => change('name', event.target.value)}
            />
          </label>
          <label className="text-[11px] font-semibold text-slate-600">
            Presentación / unidad de cantidad
            <input
              className={`${TOOL_INPUT_CLASS} mt-1`}
              value={line.presentation}
              maxLength={160}
              autoComplete="off"
              placeholder="Ej. comprimido, ampolla, frasco"
              onChange={event => change('presentation', event.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={resetSelection}
            className="justify-self-start text-[11px] font-semibold text-medical-700 underline underline-offset-2"
          >
            Buscar en el arsenal
          </button>
        </div>
      ) : (
        <div className="mb-3">
          <label
            htmlFor={`${id}-search`}
            className="mb-1 block text-[11px] font-semibold text-slate-600"
          >
            Buscar fármaco o insumo
          </label>
          <div className="relative">
            <Search
              size={14}
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-3 text-slate-400"
            />
            <input
              id={`${id}-search`}
              type="search"
              value={query}
              autoComplete="off"
              placeholder="Nombre, concentración o presentación"
              className={`${TOOL_INPUT_CLASS} pl-8`}
              aria-describedby={`${id}-results-count`}
              onChange={event => setQuery(event.target.value)}
            />
          </div>
          {query.trim() && (
            <>
              <p
                id={`${id}-results-count`}
                role="status"
                className="mt-1.5 text-[10px] text-slate-500"
              >
                {matches.length
                  ? `${matches.length} coincidencias${matches.length > 12 ? ' · mostrando las primeras 12; afina la búsqueda' : ''}`
                  : 'Sin coincidencias en el arsenal 2025.'}
              </p>
              {matches.length > 0 && (
                <ul
                  aria-label={`Resultados del arsenal, registro ${index + 1}`}
                  className="mt-2 max-h-56 overflow-y-auto rounded-md border border-slate-200 divide-y divide-slate-100"
                >
                  {matches.slice(0, 12).map(item => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="w-full px-2.5 py-2 text-left hover:bg-medical-50 focus-visible:outline-2 focus-visible:outline-medical-600"
                        onClick={() => {
                          setQuery('');
                          onChange({
                            ...line,
                            medicationId: item.id,
                            name: item.name,
                            presentation: item.presentation,
                          });
                        }}
                      >
                        <span className="block break-words text-[11px] font-semibold text-slate-800">
                          {item.name}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">
                          {item.presentation}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {!query.trim() && (
            <span id={`${id}-results-count`} className="sr-only">
              Escribe para buscar en el arsenal.
            </span>
          )}
          <button
            type="button"
            onClick={() =>
              onChange({ ...line, medicationId: 'manual', name: '', presentation: '' })
            }
            className="mt-2 text-[11px] font-semibold text-medical-700 underline underline-offset-2"
          >
            Ingresar fuera del arsenal
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="text-[11px] font-semibold text-slate-600">
          Cantidad{line.presentation ? ` (${line.presentation.toLocaleLowerCase('es-CL')})` : ''}
          <input
            className={`${TOOL_INPUT_CLASS} mt-1`}
            inputMode="decimal"
            autoComplete="off"
            value={line.quantity}
            maxLength={16}
            placeholder="0"
            onChange={event => change('quantity', event.target.value)}
          />
        </label>
        <TextField
          id={`${id}-expiry`}
          label={
            kind === 'disposal' && line.disposalCause === 'expired'
              ? 'Vencimiento (obligatorio)'
              : 'Vencimiento (si corresponde)'
          }
          type="date"
          value={line.expiry}
          onChange={value => change('expiry', value)}
        />
      </div>
      {kind === 'return' ? (
        <div className="mt-3 grid gap-3">
          <TextField
            id={`${id}-patient`}
            label="Paciente (opcional)"
            value={line.patient}
            onChange={value => change('patient', value)}
          />
          <label className="text-[11px] font-semibold text-slate-600">
            Fundamento de la devolución
            <textarea
              className="mt-1 min-h-16 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-[13px] font-normal text-slate-800 focus:border-medical-500 focus:outline-none focus:ring-2 focus:ring-medical-200"
              value={line.reason}
              maxLength={500}
              onChange={event => change('reason', event.target.value)}
            />
          </label>
        </div>
      ) : (
        <label className="mt-3 block text-[11px] font-semibold text-slate-600">
          Causa de eliminación
          <select
            className={`${TOOL_INPUT_CLASS} mt-1`}
            value={line.disposalCause}
            onChange={event => {
              const value = event.target.value;
              if (
                value === '' ||
                value === 'expired' ||
                value === 'damaged' ||
                value === 'unlabelled'
              )
                change('disposalCause', value);
            }}
          >
            <option value="">Seleccionar causa</option>
            <option value="expired">Expiración de fecha de vencimiento</option>
            <option value="damaged">Envase deteriorado</option>
            <option value="unlabelled">Envase sin rotular</option>
          </select>
        </label>
      )}
    </fieldset>
  );
};
