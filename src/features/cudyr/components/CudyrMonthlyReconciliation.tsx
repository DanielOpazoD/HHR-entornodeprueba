import { useEffect, useMemo, useRef, useState } from 'react';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import type { CudyrReconciliationFile } from '@/types/domain/cudyrReconciliation';
import type { ArchivedCudyrSupplement } from '@/services/cudyr/cudyrSupplementService';
import { compareCudyrMonth, cudyrMonthlyInventory } from '@/services/cudyr/cudyrMonthlyComparison';
import { readCudyrReconciliationFile } from '@/services/cudyr/cudyrReconciliationFile';
import { CudyrComparisonRows } from './CudyrComparisonRows';

export const CudyrMonthlyReconciliation = ({
  data,
  reports,
  ready,
  onView,
}: {
  data: CudyrReportDataset;
  reports: ArchivedCudyrSupplement[];
  ready: boolean;
  onView: (key: string) => void;
}) => {
  const [files, setFiles] = useState<CudyrReconciliationFile[]>([]);
  const [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const categoryFile = files.find(f => f.kind === 'categories');
  const dischargeFile = files.find(f => f.kind === 'discharges');
  const archive = ready ? reports.find(r => r.id === selection) : undefined;
  const categories = categoryFile?.kind === 'categories' ? categoryFile.report : archive?.report;
  const discharges = dischargeFile?.kind === 'discharges' ? dischargeFile.report : undefined;
  const inventory = useMemo(() => cudyrMonthlyInventory(data), [data]);
  const items = useMemo(
    () => compareCudyrMonth(data, categories, discharges),
    [data, categories, discharges]
  );
  const singleMonth = data.from.slice(0, 7) === data.to.slice(0, 7);
  const read = async (file: File, kind: CudyrReconciliationFile['kind']) => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setBusy(true);
    setError('');
    try {
      const parsed = await readCudyrReconciliationFile(file, kind, request.signal);
      if (request.signal.aborted) return;
      if (parsed.kind === 'categories' && parsed.report.month !== data.from.slice(0, 7))
        throw new Error(
          'Seleccione categorización del mismo mes consultado. Los turnos que cruzan el mes se mostrarán pendientes.'
        );
      if (
        parsed.kind === 'discharges' &&
        (parsed.report.from > data.from || parsed.report.to < data.to)
      )
        throw new Error('El informe de altas debe cubrir todo el período consultado.');
      setFiles(previous => [...previous.filter(f => f.kind !== kind), parsed]);
      if (kind === 'categories') setSelection('');
    } catch (caught) {
      if (!request.signal.aborted)
        setError(caught instanceof Error ? caught.message : 'No se pudo leer el archivo.');
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };
  return (
    <details
      className="rounded-xl border border-teal-200 bg-white p-4 text-sm"
      data-testid="cudyr-monthly-reconciliation"
    >
      <summary className="cursor-pointer font-semibold text-teal-900">
        Conciliar histórico · solo lectura
      </summary>
      <p className="mt-3 text-slate-600">
        Período {data.from} a {data.to}. Compara todo el período consultado, independientemente de
        los filtros del explorador. Los archivos se leen solo en este navegador; no se guardan ni
        modifican los censos, sus totales o el Excel habitual.
      </p>
      <dl className="my-4 grid grid-cols-2 gap-3 rounded-lg bg-teal-50 p-3 sm:grid-cols-3">
        {[
          ['Censos disponibles', `${inventory.availableDays}/${inventory.days}`],
          ['Filas diarias HHR', inventory.rows],
          ['Con autor CUDYR', inventory.withAuthor],
          ['Resultados manuales HHR', inventory.manual],
          ['Filas sin episodio', inventory.withoutEpisode],
          ['Elegibilidad por revisar', inventory.eligibilityPending],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-600">{label}</dt>
            <dd className="text-xl font-semibold text-teal-950">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mb-3 text-xs text-slate-600">
        Censos disponibles no equivale a población completa. Cuna y cualquier modalidad CMA
        conservan su exclusión diaria. Medias e intermedias se mantienen independientes de UPC.
      </p>
      {!singleMonth ? (
        <p role="status">Consulte un solo mes para comparar informes históricos.</p>
      ) : (
        <>
          <label className="block">
            Categorización ya guardada
            <select
              disabled={busy || !ready}
              value={archive?.id || ''}
              className="mt-1 block w-full rounded border p-2"
              onChange={e => {
                setSelection(e.target.value);
                setFiles(f => f.filter(x => x.kind !== 'categories'));
              }}
            >
              <option value="">Seleccionar una versión para cotejar</option>
              {reports
                .filter(r => r.month === data.from.slice(0, 7))
                .map(r => (
                  <option key={r.id} value={r.id}>
                    {r.file.name} · {r.report.generatedLabel} · guardado {r.importedAt} ·{' '}
                    {r.id.slice(0, 8)}
                  </option>
                ))}
            </select>
          </label>
          {!ready && (
            <p className="mt-1 text-xs text-amber-900">
              Respaldo guardado pendiente de lectura. Puede cotejar archivos locales sin presentarlo
              como lectura completa del archivo HHR.
            </p>
          )}
          <div className="my-4 grid gap-4 sm:grid-cols-2">
            {(['categories', 'discharges'] as const).map(kind => (
              <label key={kind} className="block rounded-lg border border-dashed p-3">
                {kind === 'categories'
                  ? 'Categorización Eloísa local'
                  : 'Altas administrativas locales'}
                <input
                  aria-label={
                    kind === 'categories'
                      ? 'Categorización Eloísa local'
                      : 'Altas administrativas locales'
                  }
                  type="file"
                  accept=".xls,.xlsx"
                  disabled={busy}
                  className="mt-2 block w-full min-w-0 text-xs"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void read(file, kind);
                  }}
                />
                <span className="mt-2 block text-xs text-slate-500">
                  XLS/XLSX hasta 256 KiB · reemplaza solo la selección local de este tipo
                </span>
              </label>
            ))}
          </div>
          {busy && <p role="status">Leyendo archivo local…</p>}
          {error && (
            <p role="alert" className="my-3 text-red-800">
              {error}
            </p>
          )}
          {files.map(f => (
            <div key={f.kind} className="mb-3 rounded border bg-slate-50 p-3">
              <p className="break-all font-medium">{f.name}</p>
              <p className="text-xs">
                {f.report.generatedLabel || 'Fecha de emisión no informada'} ·{' '}
                {f.kind === 'categories' ? f.report.month : `${f.report.from} a ${f.report.to}`}
              </p>
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer">Huella del archivo</summary>
                <p className="break-all">SHA-256: {f.sha256}</p>
              </details>
              <button
                type="button"
                disabled={busy}
                className="mt-1 text-xs underline"
                onClick={() => setFiles(previous => previous.filter(x => x.kind !== f.kind))}
              >
                Quitar de la comparación
              </button>
            </div>
          ))}
          {archive && (
            <p className="my-3 text-xs">
              Versión seleccionada: {archive.file.name} · {archive.report.generatedLabel}. No se
              mezclan versiones.
            </p>
          )}
          {discharges && (
            <p className="mb-3 rounded bg-amber-50 p-3 text-xs text-amber-950">
              El formato de altas examinado no identifica explícitamente el establecimiento. Sus
              filas son evidencia provisional para cotejo; la cama informada corresponde al egreso y
              no reclasifica otros días.
            </p>
          )}
          {categories || discharges ? (
            <CudyrComparisonRows
              key={`${categoryFile?.sha256 || archive?.id}:${dischargeFile?.sha256}`}
              items={items}
              data={data}
              onView={onView}
            />
          ) : (
            <p className="text-slate-500">
              Seleccione un informe para identificar coincidencias y pendientes. No se consultará
              Eloísa al comparar.
            </p>
          )}
        </>
      )}
    </details>
  );
};
