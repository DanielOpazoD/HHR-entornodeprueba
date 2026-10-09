import { CudyrExclusionSummary } from './CudyrExclusionSummary';
import { cudyrCensusAccepted } from '@/services/cudyr/cudyrCensusApproval';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { lazy, Suspense, useState } from 'react';
import {
  ArrowLeft,
  Download,
  RefreshCw,
  Info,
  FileSpreadsheet,
  CircleMinus,
  Database,
} from 'lucide-react';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useAuth } from '@/context/AuthContext';
import { useUIState } from '@/hooks/useUIState';
import { canCorrectCudyrDischarge } from '@/shared/access/operationalAccessPolicy';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { cudyrArchiveCoverage } from '@/services/cudyr/cudyrArchiveCoverage';
import { cudyrReportTotals } from '@/services/cudyr/cudyrReportModel';
import { useCudyrReport } from '../hooks/useCudyrReport';
import { CudyrArchiveStatus } from './CudyrArchiveStatus';
import { CudyrMonthlyRecovery } from './CudyrMonthlyRecovery';
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
  const { record, bootstrapPhase } = useDailyRecordData();
  const { role, currentUser } = useAuth();
  const ui = useUIState();
  const date = currentDate || record?.date || getClinicalCalendarDateISO();
  const { data, busy, error, load } = useCudyrReport(
    date,
    undefined,
    {
      date,
      version:
        record?.date === date
          ? `present:${record.lastUpdated || ''}:${record.rayenSync?.at || ''}:${record.cudyrUpdatedAt || ''}`
          : !record && bootstrapPhase === 'confirmed_empty'
            ? 'missing'
            : '',
    },
    true
  );
  const [exploring, setExploring] = useState(false);
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('all');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const rows = data?.rows.filter(row => row.date === date && !row.resolvedSystemDeparture) || [];
  const visible = rows.filter(row => filter === 'all' || row.eligibility === filter);
  const totals = cudyrReportTotals(data?.rows || []);
  const asOf = new Date(data?.generatedAt || Date.now());
  const archiveDays = data ? cudyrArchiveCoverage(data, asOf) : [];
  const archivePending = archiveDays.filter(day => day.state === 'pending').length;
  const censusPending = archiveDays.filter(
    day =>
      day.state !== 'open' && !cudyrCensusAccepted(data?.coverage.find(d => d.date === day.date))
  ).length;
  const dayPending = resolveCudyrPendingStatus(date, asOf).phase !== 'overdue';
  const dayHasEnded = date < getClinicalCalendarDateISO(asOf);
  const daily = cudyrReportTotals(rows, { includePendingApplication: dayHasEnded });
  const dailyProvisional =
    dayHasEnded &&
    Boolean(
      dayPending ||
      !cudyrCensusAccepted(data?.coverage.find(day => day.date === date)) ||
      archiveDays.find(day => day.date === date)?.state === 'pending' ||
      daily.review ||
      data?.issues.length ||
      data?.coverage.find(day => day.date === date)?.state !== 'disponible'
    );
  const evaluatedCoverage =
    data?.coverage.filter(day => resolveCudyrPendingStatus(day.date, asOf).phase === 'overdue') ||
    [];
  const lastEvaluated = evaluatedCoverage.at(-1)?.date;
  const dailyPercentage =
    dayHasEnded && daily.eligible
      ? Math.round((100 * daily.categorized) / daily.eligible) + '%'
      : '—';
  const percentage = totals.eligible
    ? Math.round((100 * totals.categorized) / totals.eligible) + '%'
    : '—';
  const partial = Boolean(
    data &&
    (archivePending ||
      censusPending ||
      data.issues.length ||
      evaluatedCoverage.some(day => day.state !== 'disponible') ||
      totals.review)
  );
  const canExport = Boolean(
    data &&
    !busy &&
    !error &&
    !data.issues.length &&
    !evaluatedCoverage.some(day => day.state === 'error')
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
              key={`${currentUser?.uid}:${date.slice(0, 7)}`}
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
          <div role="group" aria-label="Cumplimiento del día">
            <p className="text-xs text-slate-500">Cumplimiento del día</p>
            <p className="text-2xl font-semibold tabular-nums text-teal-800">
              {busy && !data ? '…' : dailyPercentage}
            </p>
            <p className="text-xs text-slate-500">
              {busy && !data
                ? 'Cargando…'
                : !dayHasEnded
                  ? 'Pendiente de aplicación'
                  : `${daily.categorized} / ${daily.eligible} elegibles${dailyProvisional ? ' · Provisional' : ''}`}
            </p>
          </div>
          <div className="border-l pl-6">
            <p className="text-xs text-slate-500">Cumplimiento acumulado · {date.slice(0, 7)}</p>
            <p className="text-xl font-semibold tabular-nums text-slate-800">
              {busy && !data ? '…' : percentage}
              {!partial &&
              data?.coverage.length &&
              data.coverage.every(d => d.reconstructionApproval) ? (
                <span className="ml-2 rounded bg-teal-50 px-1.5 py-0.5 align-middle text-[10px] font-medium text-teal-800">
                  Oficial · reparado
                </span>
              ) : null}
              {partial && (
                <span
                  className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 align-middle text-[10px] font-medium text-amber-800"
                  title="Falta confirmar el censo o completar verificaciones. Consulte el detalle de verificación."
                >
                  Provisional
                </span>
              )}
            </p>
            <p className="text-xs text-slate-500">
              {lastEvaluated
                ? `Hasta el ${lastEvaluated.split('-').reverse().join('-')}`
                : 'Sin días evaluables'}{' '}
              · {totals.categorized} CUDYR disponibles / {totals.eligible} pacientes-día elegibles
            </p>
          </div>
          <p className="text-xs text-slate-500">
            {daily.excluded} {daily.excluded === 1 ? 'excluido' : 'excluidos'}
            {daily.review > 0 && <> · {daily.review} por revisar</>}
          </p>
        </div>
        {dayPending && (
          <p role="status" className="mt-2 text-xs text-slate-600">
            {dayHasEnded
              ? 'En plazo hasta las 11:59 de hoy. Aún no se incluye en el acumulado ni en el Excel.'
              : 'Pendiente de aplicación: cierra a las 11:59 del día siguiente, hora de Rapa Nui.'}
          </p>
        )}
        {data && <CudyrExclusionSummary data={data} />}
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
      {busy && !data ? (
        <p role="status" className="rounded-xl bg-white p-8 text-slate-500">
          Leyendo información guardada en HHR…
        </p>
      ) : (
        data && <CudyrDailyTable rows={visible} onReview={setSelected} />
      )}
      <footer className="flex flex-wrap items-start gap-x-5 gap-y-2 text-[11px] text-slate-500">
        <ul className="flex flex-wrap gap-x-5 gap-y-1">
          <li className="inline-flex items-center gap-1">
            <Database size={12} aria-hidden="true" />
            Registro en Eloísa · consulta en HHR
          </li>
          <li className="inline-flex items-center gap-1">
            <FileSpreadsheet size={12} aria-hidden="true" />
            Excel: solo elegibles
          </li>
          <li className="inline-flex items-center gap-1">
            <CircleMinus size={12} aria-hidden="true" />
            Egresos: ver explorador
          </li>
        </ul>
        <details>
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-teal-800 [&::-webkit-details-marker]:hidden">
            <Info size={13} aria-hidden="true" />
            Guía breve
          </summary>
          <ul className="mt-2 max-w-lg list-disc space-y-1 pl-4">
            <li>
              <strong>No registrado:</strong> consulta completa sin CUDYR.
            </li>
            <li>
              <strong>Verificación pendiente:</strong> falta completar la consulta.
            </li>
            <li>Las excepciones manuales solo se usan si falta una exclusión automática.</li>
            <li>
              CMA y cunas permanecen visibles. Altas, traslados externos y fallecimientos se
              consultan en el explorador.
            </li>
            <li>Actualizar y descargar leen HHR; no inician una sincronización con Eloísa.</li>
          </ul>
        </details>
      </footer>
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
