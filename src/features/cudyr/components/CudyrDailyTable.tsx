import { CudyrHistoricalSourceDialog } from './CudyrHistoricalSourceDialog';
import { cudyrHasHistoricalEvidence } from '@/services/cudyr/cudyrReportPresentation';
import { useState } from 'react';
import { History, CircleMinus, FileSpreadsheet, SlidersHorizontal } from 'lucide-react';
import { CudyrMovementsDialog } from './CudyrMovementsDialog';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import { CUDYR_GROUP_LABELS } from '@/services/cudyr/cudyrReportPresentation';
import { cudyrControlStatus, cudyrCompactMoment } from '@/services/cudyr/cudyrDailyControl';

export const CudyrDailyTable = ({
  rows,
  onReview,
}: {
  rows: CudyrReportRow[];
  onReview: (key: string) => void;
}) => {
  const [sourceKey, setSourceKey] = useState('');
  const sourceRow = rows.find(row => row.key === sourceKey);
  const [movementKey, setMovementKey] = useState('');
  const movementRow = rows.find(row => row.key === movementKey);
  return (
    <>
      <div className="relative overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[960px] table-fixed text-left text-xs">
          <caption className="sr-only">Medias: NEO 1–2 y H1C1–H6C2 · Intermedias: R1–R4.</caption>
          <thead className="border-y bg-slate-50 text-[11px] text-slate-500">
            <tr>
              {[
                ['Cama · Eloísa', 'w-36'],
                ['Tipo de cama', 'w-20'],
                ['Paciente', 'w-auto'],
                ['P. DEP', 'w-14'],
                ['P. RIESGO', 'w-16'],
                ['Categoría', 'w-16'],
                ['Ingreso hosp.', 'w-32'],
                ['Registro CUDYR', 'w-36'],
                ['Estado', 'w-36'],
                ['Excepción', 'w-12'],
              ].map(([label, width]) => (
                <th key={label} scope="col" className={`px-2 py-0.5 font-medium ${width}`}>
                  {label === 'Excepción' ? (
                    <span title="Excepción manual">
                      <span className="sr-only">Excepción</span>
                      <SlidersHorizontal size={14} aria-hidden="true" />
                    </span>
                  ) : (
                    label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr
                key={row.key}
                className="h-7 border-b border-slate-100 last:border-0 hover:bg-teal-50/40"
              >
                <td
                  className="truncate px-2 py-0.5 font-medium leading-tight"
                  title={row.bedName || row.bedId}
                >
                  {row.bedName || row.bedId || '—'}
                </td>
                <td
                  className="px-2 py-0.5 text-slate-600"
                  title="Clasificación de camas médico-quirúrgicas, independiente de UPC"
                >
                  {row.modality === 'hospitalizacion' && row.group !== 'sin_grupo'
                    ? CUDYR_GROUP_LABELS[row.group]
                    : '—'}
                </td>
                <td
                  className="truncate px-2 py-0.5 text-slate-900"
                  title={`${row.patientName} · ${row.rut} · ${row.diagnosis}`}
                >
                  {row.patientName}
                </td>
                <td className="px-2 py-0.5 tabular-nums text-blue-700">
                  {row.evaluation?.dependencyScore ?? '—'}
                </td>
                <td className="px-2 py-0.5 tabular-nums text-rose-700">
                  {row.evaluation?.riskScore ?? '—'}
                </td>
                <td className="px-2 py-0.5 font-semibold text-teal-800">
                  {row.evaluation?.category || '—'}
                </td>
                <td
                  className="px-2 py-0.5 tabular-nums text-slate-600"
                  title={row.hospitalAdmissionSource}
                >
                  <div className="flex items-center gap-1">
                    <span>
                      {row.hospitalAdmissionAt
                        ? cudyrCompactMoment(row.hospitalAdmissionAt)
                        : 'Por confirmar'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setMovementKey(row.key)}
                      title="Ver movimientos de camas"
                      aria-label={`Movimientos de ${row.patientName}`}
                      className="shrink-0 rounded p-1 text-slate-400 hover:bg-teal-50 hover:text-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
                    >
                      <History size={13} />
                    </button>
                  </div>
                </td>
                <td
                  className="px-2 py-0.5 text-slate-600"
                  title={`${row.evaluation?.author || 'Autor no informado'} · ${row.evaluation?.recordedAt || 'Fecha no informada'}`}
                >
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] leading-3">
                        {row.evaluation?.author || '—'}
                      </div>
                      <div className="text-[10px] leading-3 tabular-nums">
                        {cudyrCompactMoment(row.evaluation?.recordedAt)}
                      </div>
                    </div>
                    {cudyrHasHistoricalEvidence(row) && (
                      <button
                        type="button"
                        onClick={() => setSourceKey(row.key)}
                        aria-label={`Fuente del CUDYR de ${row.patientName}`}
                        title="Ver fuente: Excel de categorización de Eloísa"
                        className="shrink-0 rounded p-1 text-teal-700 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
                      >
                        <FileSpreadsheet size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </td>
                <td className="truncate px-2 py-0.5 text-slate-600" title={row.eligibilityReason}>
                  <div>{cudyrControlStatus(row)}</div>
                  {row.eligibility === 'no_elegible' && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-800">
                      <CircleMinus size={12} aria-hidden="true" />
                      <span className="truncate">
                        {row.exclusion?.reason
                          ? 'Excepción manual'
                          : row.modality === 'cma'
                            ? 'CMA'
                            : row.modality === 'cuna'
                              ? 'Cuna RN'
                              : row.modality === 'uea'
                                ? 'UEA'
                                : 'Excluido'}
                      </span>
                    </span>
                  )}
                  {row.eligibility === 'por_revisar' && (
                    <span className="block text-[10px] text-amber-800">Elegibilidad pendiente</span>
                  )}
                </td>
                <td className="px-2 py-0.5">
                  <button
                    type="button"
                    onClick={() => onReview(row.key)}
                    aria-label={`${row.exclusion?.reason ? 'Editar' : 'Agregar'} excepción manual de ${row.patientName}`}
                    title={
                      row.exclusion?.reason ? 'Editar excepción manual' : 'Agregar excepción manual'
                    }
                    className={`rounded p-1 text-teal-800 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${row.exclusion?.reason ? 'bg-amber-50 ring-1 ring-amber-200' : ''}`}
                  >
                    <SlidersHorizontal size={15} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="p-4 text-center text-xs text-slate-500">
            No hay pacientes para este día y filtro.
          </p>
        )}
      </div>
      {sourceRow && (
        <CudyrHistoricalSourceDialog row={sourceRow} onClose={() => setSourceKey('')} />
      )}
      {movementRow && <CudyrMovementsDialog row={movementRow} onClose={() => setMovementKey('')} />}
    </>
  );
};
