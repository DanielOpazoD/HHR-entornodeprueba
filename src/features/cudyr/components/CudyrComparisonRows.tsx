import { useState } from 'react';
import type {
  CudyrComparisonItem,
  CudyrComparisonStatus,
} from '@/types/domain/cudyrReconciliation';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import { CUDYR_COMPARISON_LABELS } from '@/services/cudyr/cudyrMonthlyComparison';
import {
  CUDYR_MODALITY_LABELS,
  CUDYR_ELIGIBILITY_LABELS,
  CUDYR_GROUP_LABELS,
  cudyrSystemDischargeLabel,
} from '@/services/cudyr/cudyrReportPresentation';

export const CudyrComparisonRows = ({
  items,
  data,
  onView,
}: {
  items: CudyrComparisonItem[];
  data: CudyrReportDataset;
  onView: (key: string) => void;
}) => {
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const rows = items.filter(
    r =>
      (!filter || r.status === filter) &&
      `${r.patientName} ${r.document}`
        .toLocaleLowerCase('es')
        .includes(search.toLocaleLowerCase('es'))
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 20) - 1));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <label>
          Resultado del cotejo
          <select
            className="mt-1 block rounded border p-2"
            value={filter}
            onChange={e => {
              setFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Todos</option>
            {Object.entries(CUDYR_COMPARISON_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label} ({items.filter(r => r.status === key).length})
              </option>
            ))}
          </select>
        </label>
        <label>
          Buscar en la conciliación
          <input
            className="mt-1 block rounded border p-2"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Nombre o documento"
          />
        </label>
      </div>
      <p className="text-xs text-slate-500">
        {rows.length} entradas de cotejo; no son pacientes-día ni una nueva estadística de
        cumplimiento.
      </p>
      <div className="space-y-2">
        {rows.slice(currentPage * 20, currentPage * 20 + 20).map(item => (
          <article key={item.key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap justify-between gap-2">
              <p className="font-semibold">
                {item.patientName || 'Nombre no informado'} · {item.document || 'Sin documento'}
              </p>
              <span className={item.status === 'compatible' ? 'text-teal-800' : 'text-amber-900'}>
                {CUDYR_COMPARISON_LABELS[item.status as CudyrComparisonStatus]}
              </span>
            </div>
            <p className="mt-1">
              {item.source} · {item.sourceDate} · {item.sourceValue}
              {item.sourceRow ? ` · fila ${item.sourceRow}` : ''}
            </p>
            <p className="mt-1 text-xs text-slate-600">{item.reason}</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-teal-800">
                Contexto HHR ({item.candidateKeys.length} filas candidatas)
              </summary>
              <ul className="mt-2 space-y-2">
                {item.candidateKeys.map(key => {
                  const r = data.rows.find(row => row.key === key);
                  return (
                    r && (
                      <li key={key} className="rounded border bg-white p-2 text-xs">
                        <p>
                          {r.patientName} · Censo {r.date} · {r.bedId || 'Cama no informada'} ·{' '}
                          {CUDYR_GROUP_LABELS[r.group]} · {CUDYR_MODALITY_LABELS[r.modality]} ·{' '}
                          {CUDYR_ELIGIBILITY_LABELS[r.eligibility]}
                        </p>
                        <p>{r.diagnosis || 'Diagnóstico no informado'}</p>
                        <p>
                          CUDYR {r.evaluation?.category || 'Sin resultado'} ·{' '}
                          {r.evaluation?.source || 'Sin fuente'} · Autor:{' '}
                          {r.evaluation?.author || 'No informado'}
                        </p>
                        <p>
                          Aplicación original: {r.evaluation?.recordedAt || 'No informada'} ·
                          Episodio: {r.clinicalEpisodeId || 'No informado'}
                        </p>
                        <p>
                          Alta sistema: {cudyrSystemDischargeLabel(r)} · Alta real:{' '}
                          {r.correction?.actualDischarge
                            ? `${r.correction.actualDischarge.date} ${r.correction.actualDischarge.time || '(hora no informada)'}`
                            : 'No verificada'}
                        </p>
                        <button
                          type="button"
                          className="mt-1 underline"
                          onClick={() => onView(key)}
                        >
                          Ver detalle HHR
                        </button>
                      </li>
                    )
                  );
                })}
              </ul>
            </details>
          </article>
        ))}
      </div>
      {!rows.length && <p>No hay entradas para estos filtros.</p>}
      <nav aria-label="Páginas de conciliación" className="flex items-center justify-between">
        <button
          type="button"
          disabled={!currentPage}
          className="rounded border px-3 py-2 disabled:opacity-40"
          onClick={() => setPage(currentPage - 1)}
        >
          Anterior
        </button>
        <span>
          Página {currentPage + 1} de {Math.max(1, Math.ceil(rows.length / 20))}
        </span>
        <button
          type="button"
          disabled={(currentPage + 1) * 20 >= rows.length}
          className="rounded border px-3 py-2 disabled:opacity-40"
          onClick={() => setPage(currentPage + 1)}
        >
          Siguiente
        </button>
      </nav>
    </div>
  );
};
