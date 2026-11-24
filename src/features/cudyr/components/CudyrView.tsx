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
              className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-40"
            >
              <RefreshCw size={15} />
              Volver a leer datos
            </button>
          )}
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
      <CudyrNightStaff date={date} record={record} />
      {data?.readViewSnapshot && (
        <p role="status" className="text-xs text-slate-500">
          Última lectura guardada en HHR.{' '}
          {busy ? 'Comprobando cambios…' : 'Verificación pendiente.'}
        </p>
      )}
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
          <div className="border-l pl-6">
            <p className="text-xs text-slate-500">Cumplimiento acumulado · {date.slice(0, 7)}</p>
            <p className="text-xl font-semibold tabular-nums text-slate-800">
              {busy && !data ? '…' : percentage}
              {isOfficialRepaired ? (
                <span className="ml-2 rounded bg-teal-50 px-1.5 py-0.5 align-middle text-[10px] font-medium text-teal-800">
                  Oficial · reparado
                </span>
              ) : null}
              {partial && (
                <span title="Falta confirmar el censo o completar verificaciones. Consulte el detalle de verificación.">
                  <Info
                    size={12}
                    className="ml-2 inline text-amber-700"
                    aria-label="Verificación pendiente"
                  />
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
              ? 'En plazo hasta las 11:59 de hoy. Aún no se incluye en el cumplimiento acumulado.'
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
