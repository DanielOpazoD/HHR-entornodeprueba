import { useCudyrSupplements } from '../hooks/useCudyrSupplements';
import { CudyrSupplementPanel } from './CudyrSupplementPanel';
import { useMemo, useState } from 'react';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { canCorrectCudyrDischarge } from '@/shared/access/operationalAccessPolicy';
import { useCudyrReport } from '../hooks/useCudyrReport';
import { CudyrReportFilters } from './CudyrReportFilters';
import { CudyrReportSummary } from './CudyrReportSummary';
import { CudyrReportDetail } from './CudyrReportDetail';
import { CudyrActualDischargeDialog } from './CudyrActualDischargeDialog';
import { cudyrReportTotals } from '@/services/cudyr/cudyrReportModel';
import {
  CUDYR_GROUP_LABELS,
  CUDYR_MODALITY_LABELS,
  CUDYR_ELIGIBILITY_LABELS,
  CUDYR_STATUS_LABELS,
  EMPTY_CUDYR_REPORT_FILTERS,
  filterCudyrReportRows,
  cudyrMomentLabel,
  cudyrSystemDischargeLabel,
} from '@/services/cudyr/cudyrReportPresentation';

export default function CudyrReportExplorer({
  initialDate,
  readOnly,
  onBack,
}: {
  initialDate: string;
  readOnly: boolean;
  onBack: () => void;
}) {
  const { role } = useAuth();
  const canEdit = canCorrectCudyrDischarge({ role, readOnly });
  const { data, busy, error, load } = useCudyrReport(initialDate);
  const supplements = useCudyrSupplements(data);
  const [from, setFrom] = useState(initialDate.slice(0, 7) + '-01');
  const [to, setTo] = useState(initialDate);
  const [filters, setFilters] = useState({ ...EMPTY_CUDYR_REPORT_FILTERS });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const rows = useMemo(() => filterCudyrReportRows(data?.rows || [], filters), [data, filters]);
  const totals = useMemo(() => cudyrReportTotals(rows), [rows]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1));
  const selectedRow = data?.rows.find(row => row.key === selected);
  const exportExcel = async () => {
    if (!data || exporting || !supplements.ready) return;
    setExporting(true);
    setExportError('');
    try {
      await (
        await import('@/services/cudyr/cudyrReportWorkbook')
      ).downloadCudyrReport(data, supplements.reports);
    } catch {
      setExportError('No se pudo generar el Excel. Intente nuevamente.');
    } finally {
      setExporting(false);
    }
  };
  return (
    <div
      className="mx-auto max-w-7xl space-y-4 px-3 pb-16 sm:px-6"
      data-testid="cudyr-report-explorer"
    >
      <header className="rounded-2xl bg-teal-950 p-5 text-white sm:p-6">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-2 text-sm text-teal-100"
        >
          <ArrowLeft size={16} />
          Volver al registro CUDYR
        </button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-teal-200">
              Hospital Hanga Roa · Estadística
            </p>
            <h1 className="mt-1 text-2xl font-bold">Explorador CUDYR</h1>
            <p className="mt-2 max-w-2xl text-sm text-teal-100">
              Pacientes, camas y evaluaciones por día. La consulta utiliza la información guardada
              en HHR.
            </p>
          </div>
          <button
            type="button"
            disabled={!data || busy || exporting || !supplements.ready}
            onClick={() => void exportExcel()}
            className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-teal-950 disabled:opacity-50"
          >
            {exporting ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
            Excel completo del período
          </button>
        </div>
      </header>
      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
        onSubmit={event => {
          event.preventDefault();
          setSelected('');
          setCorrecting(false);
          setPage(0);
          void load(from, to);
        }}
      >
        <label className="text-sm font-medium">
          Desde
          <input
            type="date"
            required
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="text-sm font-medium">
          Hasta
          <input
            type="date"
            required
            value={to}
            min={from}
            onChange={e => setTo(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-50"
        >
          {busy ? 'Consultando…' : 'Consultar período'}
        </button>
        <p className="text-xs text-slate-500">Hasta 32 días · Horario de Rapa Nui</p>
      </form>
      {(error || exportError) && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error || exportError}
        </p>
      )}
      {busy && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl bg-white p-6 text-slate-600"
        >
          <Loader2 className="animate-spin" size={20} />
          Leyendo censos, historial y altas guardadas…
        </div>
      )}
      {data && (
        <>
          <p className="text-sm text-slate-600">
            Período consultado:{' '}
            <strong>
              {data.from} a {data.to}
            </strong>{' '}
            · Lectura {cudyrMomentLabel(data.generatedAt)}. El Excel incluye todo el período; los
            filtros se aplican a esta vista.
          </p>
          {(data.issues.length > 0 || data.coverage.some(day => day.state !== 'disponible')) && (
            <div
              role="status"
              className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
            >
              <p className="font-semibold">
                Cobertura parcial: revise antes de informar a Estadística.
              </p>
              {data.issues.map((issue, i) => (
                <p key={i}>{issue}</p>
              ))}
              <p>
                {data.coverage.filter(day => day.state !== 'disponible').length} días sin censo
                disponible o con error de lectura.
              </p>
            </div>
          )}
          {!supplements.ready && (
            <p role="status" className="text-sm text-amber-800">
              {supplements.error ||
                'Completando la lectura del respaldo antes de habilitar el Excel completo…'}
            </p>
          )}
          <CudyrSupplementPanel
            reports={supplements.reports}
            ready={supplements.ready}
            error={supplements.error}
            from={data.from}
            to={data.to}
            canImport={canEdit}
            onReload={supplements.reload}
          />
          <CudyrReportFilters
            rows={data.rows}
            filters={filters}
            onChange={next => {
              setFilters(next);
              setPage(0);
            }}
          />
          <CudyrReportSummary totals={totals} />
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <caption className="p-4 text-left text-sm text-slate-600">
                {rows.length} pacientes-día · Medias: NEO 1–2 y H1C1–H6C2 · Intermedias: R1–R4 ·
                Independiente de UPC
              </caption>
              <thead className="border-y border-slate-200 bg-slate-50 text-xs text-slate-600">
                <tr>
                  {[
                    'Día / cama',
                    'Paciente / documento',
                    'Diagnóstico',
                    'Grupo / modalidad',
                    'Elegibilidad',
                    'CUDYR / autor',
                    'Detalle',
                  ].map(text => (
                    <th key={text} scope="col" className="px-3 py-3">
                      {text}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(currentPage * 50, currentPage * 50 + 50).map(row => (
                  <tr
                    key={row.key}
                    className="border-b border-slate-100 align-top hover:bg-teal-50/40"
                  >
                    <td className="whitespace-nowrap px-3 py-3">
                      <p>{row.date}</p>
                      <p className="font-semibold">{row.bedId || 'Por aclarar'}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-semibold text-slate-900">
                        {row.patientName || 'Nombre no informado'}
                      </p>
                      <p className="text-xs text-slate-500">{row.rut || 'Sin documento'}</p>
                    </td>
                    <td className="max-w-60 px-3 py-3 text-slate-600">
                      {row.diagnosis || 'No informado'}
                    </td>
                    <td className="px-3 py-3">
                      <p>{CUDYR_GROUP_LABELS[row.group]}</p>
                      <p className="text-xs text-slate-500">
                        {CUDYR_MODALITY_LABELS[row.modality]}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={
                          row.eligibility === 'por_revisar' ? 'text-amber-800' : 'text-slate-700'
                        }
                      >
                        {CUDYR_ELIGIBILITY_LABELS[row.eligibility]}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-semibold">
                        {row.evaluation?.category || '—'}{' '}
                        <span className="text-xs font-normal text-slate-500">
                          {CUDYR_STATUS_LABELS[row.cudyrStatus]}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {row.evaluation?.author || 'Autor no informado'}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => setSelected(row.key)}
                        aria-label={'Ver detalle de ' + row.patientName + ' del ' + row.date}
                        className="rounded-lg border border-teal-200 px-3 py-1.5 font-medium text-teal-800"
                      >
                        Ver
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="p-6 text-center text-slate-500">
                No hay pacientes-día con estos filtros.
              </p>
            )}
          </div>
          <nav
            aria-label="Páginas del reporte"
            className="flex items-center justify-between text-sm"
          >
            <button
              type="button"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
              className="rounded-lg border px-3 py-2 disabled:opacity-40"
            >
              Anterior
            </button>
            <span>
              Página {currentPage + 1} de {Math.max(1, Math.ceil(rows.length / 50))}
            </span>
            <button
              type="button"
              disabled={(currentPage + 1) * 50 >= rows.length}
              onClick={() => setPage(currentPage + 1)}
              className="rounded-lg border px-3 py-2 disabled:opacity-40"
            >
              Siguiente
            </button>
          </nav>
          <details className="rounded-xl border bg-white p-4 text-sm">
            <summary className="cursor-pointer font-medium">
              Cobertura y criterios de lectura
            </summary>
            <p className="mt-3">
              Cunas y CMA quedan visibles y excluidos del cálculo. Cada día conserva su contexto;
              una cama actual no reclasifica toda la hospitalización. Las contradicciones quedan por
              revisar.
            </p>
            <p className="mt-2">
              El alta del sistema, la epicrisis y el alta física verificada se muestran por
              separado. Las horas no informadas permanecen desconocidas.
            </p>
            <ul className="mt-3 grid grid-cols-1 gap-1 text-xs text-slate-600 sm:grid-cols-3">
              {data.coverage.map(day => (
                <li key={day.date}>
                  {day.date} · {day.state}
                </li>
              ))}
            </ul>
          </details>
          {selectedRow && !correcting && (
            <CudyrReportDetail
              row={selectedRow}
              data={data}
              supplementsReady={supplements.ready}
              supplements={supplements.reports}
              canEdit={canEdit}
              onClose={() => setSelected('')}
              onCorrect={() => setCorrecting(true)}
            />
          )}
          {selectedRow && correcting && (
            <CudyrActualDischargeDialog
              key={selectedRow.key + ':' + (selectedRow.correction?.revision || 0)}
              clinicalEpisodeId={selectedRow.clinicalEpisodeId}
              authorityDate={selectedRow.authorityDate}
              patientName={selectedRow.patientName}
              admissionDate={selectedRow.admissionDate}
              sourceDischargeLabel={cudyrSystemDischargeLabel(selectedRow)}
              correction={selectedRow.correction}
              canEdit={canEdit}
              onClose={() => setCorrecting(false)}
              onSaved={() => {
                setSelected('');
                void load(data.from, data.to);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
