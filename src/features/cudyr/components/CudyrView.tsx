import { monthlyRecoveryWindow } from '@/features/cudyr/recovery/cudyrMonthlyRecoveryPlan';
import { CudyrNightStaff } from './CudyrNightStaff';
import { CudyrExclusionSummary } from './CudyrExclusionSummary';
import { Suspense, useMemo, useState } from 'react';
import { lazyWithRetry } from '@/components/ui/lazyWithRetry';
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
import type { UseUIStateReturn } from '@/hooks/useUIState';
import { canCorrectCudyrDischarge } from '@/shared/access/operationalAccessPolicy';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import {
  buildCudyrRecordVersion,
  buildCudyrViewModel,
} from '../controllers/cudyrViewModelController';
import { useCudyrReport } from '../hooks/useCudyrReport';
import { CudyrArchiveStatus } from './CudyrArchiveStatus';
import { CudyrMonthlyRecovery } from './CudyrMonthlyRecovery';
import { CudyrDailyTable } from './CudyrDailyTable';
import { CudyrExclusionDialog } from './CudyrExclusionDialog';
const CudyrReportExplorer = lazyWithRetry(() => import('./CudyrReportExplorer'));

export const CudyrView = ({
  readOnly = false,
  currentDate,
  ui,
}: {
  readOnly?: boolean;
  currentDate?: string;
  /** The app's own navigation, never a copy: going back shows the census and its URL. */
  ui: Pick<UseUIStateReturn, 'setCurrentModule'>;
}) => {
  const { record, bootstrapPhase } = useDailyRecordData();
  const { role, currentUser } = useAuth();
  const date = currentDate || record?.date || getClinicalCalendarDateISO();
  const { data, busy, error, load } = useCudyrReport(
    date,
    undefined,
    buildCudyrRecordVersion({ date, record, bootstrapPhase }),
    true
  );
  const [exploring, setExploring] = useState(false);
  const [selected, setSelected] = useState('');
  const [filter, setFilter] = useState('all');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const {
    visibleRows,
    filterCounts,
    totals,
    daily,
    dayPending,
    dayHasEnded,
    dailyProvisional,
    lastEvaluated,
    dailyPercentage,
    percentage,
    partial,
    isOfficialRepaired,
    canExport,
    selectedRow,
  } = useMemo(
    () =>
      buildCudyrViewModel({
        data,
        date,
        filter,
        selectedRowKey: selected,
        busy,
        error,
      }),
    [busy, data, date, error, filter, selected]
  );
  const filterOptions = [
    { value: 'all', label: 'Todos', count: filterCounts.all },
    { value: 'elegible', label: 'Elegibles', count: filterCounts.elegible },
    { value: 'no_elegible', label: 'Excluidos', count: filterCounts.no_elegible },
    { value: 'por_revisar', label: 'Por revisar', count: filterCounts.por_revisar },
  ] as const;
  const refresh = (reuseConfirmedRecovery = false) => {
    setSelected('');
    setExportError('');
    void load(date.slice(0, 7) + '-01', date, reuseConfirmedRecovery);
  };
  const download = async () => {
    if (!canExport || !data || exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const { downloadCudyrEssential } =
        await import('@/features/cudyr/export/cudyrEssentialWorkbook');
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
            refresh(true);
          }}
        />
      </Suspense>
    );
  return (
    <section className="mx-auto max-w-7xl space-y-2.5 px-3 pb-6 sm:px-5" aria-label="Control CUDYR">
      <div className="rounded-xl border border-slate-200/90 bg-white shadow-xs">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3.5 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <button
              type="button"
              onClick={() => ui.setCurrentModule('CENSUS')}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            >
              <ArrowLeft size={13} />
              Volver al censo
            </button>
            <span className="hidden h-4 w-px bg-slate-200 sm:inline-block" aria-hidden="true" />
            <h1 className="text-[15px] font-semibold leading-tight text-slate-900">
              CUDYR · control diario
            </h1>
            <span className="text-xs text-slate-500">
              Turno noche {date.split('-').reverse().join('-')} · Rapa Nui
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {canCorrectCudyrDischarge({ role, readOnly }) && (
              <CudyrMonthlyRecovery
                key={`${currentUser?.uid}:${date.slice(0, 7)}`}
                month={date.slice(0, 7)}
                compact
                disabled={busy}
                onSaved={() => refresh(true)}
              />
            )}
            {(!canCorrectCudyrDischarge({ role, readOnly }) ||
              !monthlyRecoveryWindow(date.slice(0, 7))) && (
              <button
                type="button"
                onClick={() => refresh()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
              >
                <RefreshCw size={13} />
                Volver a leer datos
              </button>
            )}
            <button
              type="button"
              onClick={() => void download()}
              disabled={!canExport || exporting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-800 disabled:opacity-40"
            >
              <Download size={14} />
              {exporting ? 'Preparando…' : 'Excel mensual'}
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 items-center gap-x-5 gap-y-2 px-3.5 py-2 lg:grid-cols-[auto_auto_minmax(0,1fr)]">
          <div role="group" aria-label="Cumplimiento del día" className="min-w-0">
            <p className="text-[11px] font-medium text-slate-500">Cumplimiento del día</p>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <p className="text-lg font-bold leading-none tabular-nums text-teal-800">
                {busy && !data ? '…' : dailyPercentage}
              </p>
              <p className="text-xs text-slate-500">
                {busy && !data
                  ? 'Cargando…'
                  : !dayHasEnded
                    ? 'Pendiente de aplicación'
                    : `${daily.categorized} / ${daily.eligible} elegibles`}
                {dailyProvisional && (
                  <Info
                    size={12}
                    className="ml-1 inline text-amber-700"
                    aria-label="Verificación pendiente"
                  />
                )}
              </p>
            </div>
          </div>

          <div className="min-w-0 border-t border-slate-100 pt-2 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <span>Cumplimiento acumulado · {date.slice(0, 7)}</span>
              {isOfficialRepaired ? (
                <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-800">
                  Oficial · reparado
                </span>
              ) : null}
              {partial && (
                <span title="Falta confirmar el censo o completar verificaciones. Consulte el detalle de verificación.">
                  <Info
                    size={12}
                    className="inline text-amber-700"
                    aria-label="Verificación pendiente"
                  />
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <p className="text-lg font-bold leading-none tabular-nums text-slate-800">
                {busy && !data ? '…' : percentage}
              </p>
              <p className="text-xs text-slate-500">
                {lastEvaluated
                  ? `Hasta el ${lastEvaluated.split('-').reverse().join('-')}`
                  : 'Sin días evaluables'}{' '}
                · {totals.categorized} CUDYR disponibles / {totals.eligible} pacientes-día elegibles
              </p>
            </div>
          </div>

          <CudyrNightStaff date={date} record={record} embedded />
        </div>

        {(dayPending || data) && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-slate-100 bg-slate-50/50 px-3.5 py-1.5 text-[11px] text-slate-600">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {data && <CudyrExclusionSummary data={data} embedded />}
              {dayPending && (
                <p role="status" className="text-slate-600">
                  {dayHasEnded
                    ? 'En plazo hasta las 11:59 de hoy. Aún no se incluye en el cumplimiento acumulado.'
                    : 'Pendiente de aplicación: cierra a las 11:59 del día siguiente, hora de Rapa Nui.'}
                </p>
              )}
            </div>
            {data?.readViewSnapshot && (
              <p role="status" className="text-slate-500">
                Última lectura guardada en HHR.{' '}
                {busy ? 'Comprobando cambios…' : 'Verificación pendiente.'}
              </p>
            )}
          </div>
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Filtrar casos CUDYR"
          className="flex flex-wrap items-center gap-1.5"
        >
          {filterOptions.map(option => {
            const isActive = filter === option.value;
            const isPendingAlert = option.value === 'por_revisar' && option.count > 0 && !isActive;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                onClick={() => setFilter(option.value)}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${
                  isActive
                    ? 'bg-teal-700 text-white shadow-xs'
                    : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span>{option.label}</span>{' '}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : isPendingAlert
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {option.count}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setExploring(true)}
          className="text-xs font-medium text-teal-800 underline underline-offset-4 hover:text-teal-900"
        >
          Explorar reporte estadístico
        </button>
      </div>
      {busy && !data ? (
        <p role="status" className="rounded-xl bg-white p-8 text-slate-500">
          Leyendo información guardada en HHR…
        </p>
      ) : (
        data && <CudyrDailyTable rows={visibleRows} onReview={setSelected} />
      )}
      <footer className="flex flex-wrap items-start gap-x-5 gap-y-2 text-[11px] text-slate-500">
        <ul className="flex flex-wrap gap-x-5 gap-y-1">
          <li className="inline-flex items-center gap-1">
            <Database size={12} aria-hidden="true" />
            Registro en Eloísa · consulta en HHR
          </li>
          <li className="inline-flex items-center gap-1">
            <FileSpreadsheet size={12} aria-hidden="true" />
            Excel: resumen y detalle diario
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
            <li>
              Actualizar CUDYR consulta los pendientes en Eloísa; los días verificados se conservan.
              Descargar utiliza los datos guardados en HHR.
            </li>
          </ul>
        </details>
      </footer>
      {selectedRow && (
        <CudyrExclusionDialog
          key={`${currentUser?.uid}:${role}:${selectedRow.key}:${selectedRow.exclusion?.revision || 0}`}
          row={selectedRow}
          canEdit={canCorrectCudyrDischarge({ role, readOnly }) && !data?.issues.length}
          onClose={() => setSelected('')}
          onSaved={() => refresh()}
        />
      )}
    </section>
  );
};
