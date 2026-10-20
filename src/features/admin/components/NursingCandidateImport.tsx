import React, { useState } from 'react';
import { parseNursingCandidates, type NursingCandidate } from '../domain/nursingCandidates';
export default function NursingCandidateImport({
  existingRuts,
  onSelect,
}: {
  existingRuts: string[];
  onSelect: (row: NursingCandidate) => void;
}) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<NursingCandidate[]>([]);
  const [error, setError] = useState('');
  return (
    <details className="rounded border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Revisar candidatos del mantenedor</summary>
      <p className="my-2">
        Pega hasta 100 filas: nombre; RUT; referencia de origen. Una fila por persona. Se revisan en
        este navegador; no se crean cuentas en lote ni se decide identidad por semejanza de nombres.
      </p>
      <textarea
        aria-label="Candidatos de enfermería"
        value={text}
        onChange={event => setText(event.target.value)}
        maxLength={20000}
        className="h-28 w-full rounded border p-2"
        autoComplete="off"
      />
      <button
        type="button"
        onClick={() => {
          try {
            setRows(parseNursingCandidates(text, existingRuts));
            setError('');
          } catch (failure) {
            setError((failure as Error).message);
          }
        }}
        className="my-2 rounded border px-3 py-1"
      >
        Revisar candidatos
      </button>
      <button
        type="button"
        onClick={() => {
          setText('');
          setRows([]);
          setError('');
        }}
        className="ml-3"
      >
        Limpiar candidatos
      </button>
      {error && <p role="alert">{error}</p>}
      <ul className="max-h-56 overflow-auto">
        {rows.map((row, index) => (
          <li key={index} className="flex items-center justify-between gap-3 border-t py-2">
            <span>
              {row.name} · {row.rut} · {row.issue || row.sourceReference}
            </span>
            <button
              type="button"
              disabled={Boolean(row.issue)}
              className="text-sky-800 disabled:text-slate-400"
              onClick={() => {
                onSelect(row);
                setRows([]);
                setText('');
              }}
            >
              Revisar persona
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
