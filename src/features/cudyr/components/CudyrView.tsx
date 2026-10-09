import { CudyrArchiveStatus } from './CudyrArchiveStatus';
import { CudyrMonthlyRecovery } from './CudyrMonthlyRecovery';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, RefreshCw } from 'lucide-react';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useAuth } from '@/context/AuthContext';
import { useUIState } from '@/hooks/useUIState';
import { canCorrectCudyrDischarge } from '@/shared/access/operationalAccessPolicy';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { cudyrReportTotals } from '@/services/cudyr/cudyrReportModel';
import { cudyrMomentLabel } from '@/services/cudyr/cudyrReportPresentation';
import { useCudyrReport } from '../hooks/useCudyrReport';
import { CudyrDailyTable } from './CudyrDailyTable';
import { CudyrExclusionDialog } from './CudyrExclusionDialog';
const CudyrReportExplorer = lazy(() => import('./CudyrReportExplorer'));

export const CudyrView = ({
  readOnly = false,
  currentDate,
}: {
  readOnly?: boolean;
  currentDate?: string;
}) => {
  const { record } = useDailyRecordData();
  const { role, currentUser } = useAuth();
  const ui = useUIState();
  const date = currentDate || record?.date || getClinicalCalendarDateISO();
  const { data, busy, error, load } = useCudyrReport(date);
  const [exploring, setExploring] = useState(false);
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('elegible');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const sync = record?.rayenSync?.at || '';
  const lastSync = useRef({ date, sync });
  useEffect(() => {
    if (lastSync.current.date === date && lastSync.current.sync !== sync)
      void load(date.slice(0, 7) + '-01', date);
    lastSync.current = { date, sync };
  }, [date, sync, load]);
  const rows = data?.rows.filter(row => row.date === date) || [];
  const visible = rows.filter(row => filter === 'all' || row.eligibility === filter);
  const totals = cudyrReportTotals(data?.rows || []);
  const daily = cudyrReportTotals(rows);
  const asOf = new Date(data?.generatedAt || Date.now());
  const dayPending = resolveCudyrPendingStatus(date, asOf).phase !== 'overdue';
  const evaluatedCoverage =
    data?.coverage.filter(day => resolveCudyrPendingStatus(day.date, asOf).phase === 'overdue') ||
    [];
  const lastEvaluated = evaluatedCoverage.at(-1)?.date;
  const dailyPercentage =
    !dayPending && daily.eligible
      ? Math.round((100 * daily.categorized) / daily.eligible) + '%'
      : '—';
  const percentage = totals.eligible
    ? Math.round((100 * totals.categorized) / totals.eligible) + '%'
    : '—';
  const partial = Boolean(
    data &&
    (data.issues.length ||
      evaluatedCoverage.some(day => day.state !== 'disponible') ||
      totals.review)
  );
  const canExport = Boolean(
    data && !busy && !data.issues.length && !evaluatedCoverage.some(day => day.state === 'error')
  );
  const selectedRow = !busy && data?.rows.find(row => row.key === selected && row.date === date);
  const refresh = () => {
    setSelected('');
    setExportError('');
    void load(date.slice(0, 7) + '-01', date);
  };
  const download = async () => {
    if (!canExport || !data || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const { downloadCudyrEssential } = await import('@/services/cudyr/cudyrEssentialWorkbook');
      await downloadCudyrEssential(data);
    } catch (caught) {
      setExportError(caught instanceof Error ? caught.message : 'No se pudo generar el Excel.');
    } finally {
      setExporting(false);
    }
  };
  if (exploring)
    return (
      <Suspense
        fallback={
          <p role="status" className="p-8">
            Abriendo explorador…
          </p>
        }
      >
        <CudyrReportExplorer
          initialDate={date}
          readOnly={readOnly}
          onBack={() => {
            setExploring(false);
            refresh();
          }}
        />
      </Suspense>
    );
  return (
    <section className="mx-auto max-w-7xl space-y-3 px-3 pb-6 sm:px-5" aria-label="Control CUDYR">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => ui.setCurrentModule('CENSUS')}
            className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500"
          >
            <ArrowLeft size={14} />
            Volver al censo
          </button>
          <h1 className="text-xl font-semibold text-slate-900">CUDYR · control diario</h1>
          <p className="mt-1 text-sm text-slate-500">
            Turno noche {date.split('-').reverse().join('-')} · Horario de Rapa Nui
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCorrectCudyrDischarge({ role, readOnly }) && (
            <CudyrMonthlyRecovery
              key={date.slice(0, 7)}
              month={date.slice(0, 7)}
              compact
              onSaved={refresh}
            />
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-40"
          >
            <RefreshCw size={15} />
            Actualizar vista
          </button>
          <button
            type="button"
            onClick={() => void download()}
            disabled={!canExport || exporting}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            <Download size={16} />
            {exporting ? 'Preparando…' : 'Excel mensual'}
          </button>
        </div>
      </header>
      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
          <div>
            <p className="text-xs text-slate-500">Cumplimiento del día</p>
            <p className="text-2xl font-semibold tabular-nums text-teal-800">
              {busy ? '…' : dailyPercentage}
            </p>
            <p className="text-xs text-slate-500">
              {dayPending
                ? 'Pendiente de aplicación'
                : `${daily.categorized} / ${daily.eligible} elegibles`}
            </p>
          </div>
          <div className="border-l pl-6">
            <p className="text-xs text-slate-500">Cumplimiento acumulado · {date.slice(0, 7)}</p>
            <p className="text-xl font-semibold tabular-nums text-slate-800">
              {busy ? '…' : percentage}
            </p>
            <p className="text-xs text-slate-500">
              {lastEvaluated
                ? `Hasta el ${lastEvaluated.split('-').reverse().join('-')}`
                : 'Sin días evaluables'}{' '}
              · {totals.categorized} CUDYR confirmados / {totals.eligible} pacientes-día elegibles
            </p>
          </div>
          <p className="text-xs text-slate-500">
            {rows.filter(row => row.eligibility === 'no_elegible').length} excluidos ·{' '}
            {rows.filter(row => row.eligibility === 'por_revisar').length} por revisar
          </p>
        </div>
        {dayPending && (
          <p role="status" className="mt-2 text-xs text-slate-600">
            Este día no entra al cumplimiento ni al Excel de elegibles. Su ventana de aplicación
            termina al mediodía siguiente, en horario de Rapa Nui.
          </p>
        )}
        {partial && (
          <p role="status" className="mt-2 text-xs text-amber-800">
            Acumulado provisional · {totals.review} por revisar; compruebe los días sin censo o las
            lecturas incompletas en el explorador.
          </p>
        )}
      </div>
      {data && (
        <CudyrArchiveStatus
          data={data}
          busy={busy}
          error={error}
          canApprove={canCorrectCudyrDischarge({ role, readOnly })}
          onApproved={refresh}
        />
      )}
      {(error || exportError) && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error || exportError}
        </p>
      )}
      {data?.issues.map(issue => (
        <p key={issue} role="alert" className="text-sm text-amber-900">
          {issue}
        </p>
      ))}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="text-sm text-slate-600">
          Mostrar{' '}
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="ml-2 rounded-md border bg-white px-2 py-1 text-xs"
          >
            <option value="all">Todos los casos</option>
            <option value="elegible">Elegibles</option>
            <option value="no_elegible">Excluidos</option>
            <option value="por_revisar">Por revisar</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => setExploring(true)}
          className="text-sm font-medium text-teal-800 underline underline-offset-4"
        >
          Explorar reporte estadístico
        </button>
      </div>
      {busy ? (
        <p role="status" className="rounded-xl bg-white p-8 text-slate-500">
          Leyendo información guardada en HHR…
        </p>
      ) : (
        data && <CudyrDailyTable rows={visible} onReview={setSelected} />
      )}
      <p className="text-xs leading-relaxed text-slate-500">
        El CUDYR se registra en Eloísa. Actualizar y descargar solo leen lo guardado en HHR. «Sin
        CUDYR encontrado» no confirma que no se haya realizado. Los excluidos permanecen aquí y no
        se incluyen en el Excel sencillo.{' '}
        {data && <>Última lectura: {cudyrMomentLabel(data.generatedAt)}.</>}
      </p>
      {selectedRow && (
        <CudyrExclusionDialog
          key={`${currentUser?.uid}:${role}:${selectedRow.key}:${selectedRow.exclusion?.revision || 0}`}
          row={selectedRow}
          canEdit={canCorrectCudyrDischarge({ role, readOnly }) && !data?.issues.length}
          onClose={() => setSelected('')}
          onSaved={refresh}
        />
      )}
    </section>
  );
};
