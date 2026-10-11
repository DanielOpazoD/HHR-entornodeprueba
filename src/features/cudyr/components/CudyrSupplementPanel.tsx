import { useMemo, useState } from 'react';
import type { ArchivedCudyrSupplement } from '@/services/cudyr/cudyrSupplementService';
import { cudyrMomentLabel } from '@/services/cudyr/cudyrReportPresentation';
import { CudyrSupplementImport } from './CudyrSupplementImport';
export const CudyrSupplementPanel = ({
  reports,
  ready,
  error,
  from,
  to,
  canImport,
  onReload,
}: {
  reports: ArchivedCudyrSupplement[];
  ready: boolean;
  error: string;
  from: string;
  to: string;
  canImport: boolean;
  onReload: () => void;
}) => {
  const [selection, setSelection] = useState(''),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(0);
  const ordered = useMemo(
    () => [...reports].sort((a, b) => b.importedAt.localeCompare(a.importedAt)),
    [reports]
  );
  const archive = ordered.find(r => r.id === selection) || ordered[0];
  const rows =
    archive?.report.patients.filter(p =>
      `${p.patientName} ${p.document} ${p.diagnosis}`
        .toLocaleLowerCase('es')
        .includes(search.toLocaleLowerCase('es'))
    ) || [];
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 20) - 1));
  return (
    <details
      className="rounded-xl border border-slate-200 bg-white p-4 text-sm"
      data-testid="cudyr-supplement-panel"
    >
      <summary className="cursor-pointer font-medium">
        Respaldo mensual de Eloísa {ready ? `(${reports.length} versiones)` : '· lectura pendiente'}
      </summary>
      <p className="mt-3 text-slate-600">
        Evidencia complementaria del informe mensual. Conserva el día escrito en Eloísa; no acredita
        hora, autor, cama ni episodio y no altera los totales del reporte.
      </p>
      {error ? (
        <div role="alert" className="mt-3 text-red-800">
          {error}{' '}
          <button type="button" onClick={onReload} className="underline">
            Reintentar lectura
          </button>
        </div>
      ) : !ready ? (
        <p role="status" className="mt-3">
          Leyendo respaldo guardado en HHR…
        </p>
      ) : !reports.length ? (
        <p className="mt-3 text-slate-500">
          No hay informes mensuales guardados para este período.
        </p>
      ) : null}
      {archive && (
        <div className="mt-4 space-y-3">
          <label className="block font-medium">
            Archivo / versión
            <select
              value={archive.id}
              onChange={e => {
                setSelection(e.target.value);
                setPage(0);
              }}
              className="mt-1 block w-full rounded-lg border p-2"
            >
              {ordered.map(r => (
                <option key={r.id} value={r.id}>
                  {r.month} · {r.file.name} · importado {cudyrMomentLabel(r.importedAt)} ·{' '}
                  {r.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-slate-500">
            Importó {archive.importedBy.name} · {cudyrMomentLabel(archive.importedAt)}.{' '}
            {archive.report.generatedLabel}.{' '}
            {reports.filter(r => r.contentId === archive.contentId).length} versiones con contenido
            equivalente.
          </p>
          <label className="block">
            Buscar en este archivo
            <input
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder="Nombre, documento o diagnóstico"
              className="mt-1 block w-full rounded-lg border p-2"
            />
          </label>
          <p className="text-xs text-slate-500">
            Filas originales sin vínculo de episodio. Se muestran las celdas informadas entre {from}{' '}
            y {to}; una celda vacía no prueba incumplimiento.
          </p>
          <div className="space-y-2">
            {rows.slice(currentPage * 20, currentPage * 20 + 20).map(p => (
              <article key={p.sourceRow} className="rounded-lg border bg-slate-50 p-3">
                <p className="font-semibold">
                  {p.patientName} · {p.document || 'Documento no informado'}
                </p>
                <p>{p.diagnosis || 'Diagnóstico no informado'}</p>
                <p className="text-xs text-slate-500">
                  {p.service || 'Servicio no informado'} · Alta:{' '}
                  {p.dischargeCondition || 'No informada'} · Fila fuente {p.sourceRow} · Ficha{' '}
                  {p.clinicalRecord || 'No informada'}
                </p>
                <p className="mt-2 break-words text-xs">
                  {p.days
                    .filter(d => d.sourceDate >= from && d.sourceDate <= to && d.state !== 'blank')
                    .map(d => `${d.sourceDate}: ${d.originalValue}`)
                    .join(' · ') || 'Sin celdas informadas en este intervalo.'}
                </p>
              </article>
            ))}
          </div>
          <nav
            aria-label="Filas del respaldo mensual"
            className="flex items-center justify-between gap-3"
          >
            <button
              type="button"
              disabled={!currentPage}
              onClick={() => setPage(currentPage - 1)}
              className="rounded border px-3 py-2 disabled:opacity-40"
            >
              Anterior
            </button>
            <span>
              {rows.length} filas · página {currentPage + 1}
            </span>
            <button
              type="button"
              disabled={(currentPage + 1) * 20 >= rows.length}
              onClick={() => setPage(currentPage + 1)}
              className="rounded border px-3 py-2 disabled:opacity-40"
            >
              Siguiente
            </button>
          </nav>
        </div>
      )}
      {canImport && (
        <CudyrSupplementImport key={from + to} from={from} to={to} onSaved={onReload} />
      )}
    </details>
  );
};
