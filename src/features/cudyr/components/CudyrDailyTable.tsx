import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import { CUDYR_GROUP_LABELS, cudyrMomentLabel } from '@/services/cudyr/cudyrReportPresentation';
import { cudyrControlStatus, cudyrEligibilityOrigin } from '@/services/cudyr/cudyrDailyControl';

export const CudyrDailyTable = ({
  rows,
  onReview,
}: {
  rows: CudyrReportRow[];
  onReview: (key: string) => void;
}) => (
  <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
    <table className="w-full min-w-[780px] text-left text-sm">
      <caption className="p-4 text-left text-xs text-slate-500">
        Resultados de solo lectura · Medias: NEO 1–2 y H1C1–H6C2 · Intermedias: R1–R4 ·
        Independiente de UPC
      </caption>
      <thead className="border-y bg-slate-50 text-xs text-slate-600">
        <tr>
          {[
            'Cama',
            'Paciente',
            'P. DEP',
            'P. RIESGO',
            'Categoría',
            'Estado / última consulta',
            'Revisión',
          ].map(label => (
            <th key={label} scope="col" className="px-3 py-3">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.key} className="border-b border-slate-100 align-top hover:bg-teal-50/30">
            <td className="px-3 py-4">
              <p className="font-semibold">{row.bedName || row.bedId || '—'}</p>
              <p className="text-xs text-slate-500">{CUDYR_GROUP_LABELS[row.group]}</p>
            </td>
            <td className="max-w-64 px-3 py-4">
              <p className="font-semibold text-slate-900">{row.patientName}</p>
              <p className="text-xs text-slate-500">{row.rut}</p>
              <p className="mt-1 text-xs text-slate-600">
                {row.diagnosis || 'Diagnóstico no informado'}
              </p>
            </td>
            <td className="px-3 py-4 font-semibold text-blue-700">
              {row.evaluation?.dependencyScore ?? '—'}
            </td>
            <td className="px-3 py-4 font-semibold text-rose-700">
              {row.evaluation?.riskScore ?? '—'}
            </td>
            <td className="px-3 py-4">
              <span className="rounded-md bg-teal-50 px-2 py-1 font-bold text-teal-900">
                {row.evaluation?.category || '—'}
              </span>
              <p className="mt-2 text-xs text-slate-500">
                {row.evaluation?.author || 'Autor no informado'}
              </p>
              {row.evaluation?.source && (
                <p className="text-xs text-slate-500">Origen: {row.evaluation.source}</p>
              )}
              {row.evaluation?.recordedAt && (
                <p className="text-xs text-slate-500">
                  {cudyrMomentLabel(row.evaluation.recordedAt)}
                </p>
              )}
            </td>
            <td className="max-w-64 px-3 py-4">
              <p
                className={
                  row.eligibility === 'no_elegible'
                    ? 'font-medium text-slate-600'
                    : 'font-medium text-teal-800'
                }
              >
                {row.eligibility === 'no_elegible'
                  ? 'Excluido'
                  : row.eligibility === 'por_revisar'
                    ? 'Elegibilidad por revisar'
                    : 'Elegible'}
              </p>
              <p className="mt-1 text-xs">{row.eligibilityReason}</p>
              <p className="mt-1 text-xs text-slate-500">{cudyrEligibilityOrigin(row)}</p>
              <p className="mt-2 text-xs font-medium">{cudyrControlStatus(row)}</p>
              {row.lastCaptureAt && (
                <p className="text-xs text-slate-500">{cudyrMomentLabel(row.lastCaptureAt)}</p>
              )}
            </td>
            <td className="px-3 py-4">
              <button
                type="button"
                onClick={() => onReview(row.key)}
                aria-label={`Revisar elegibilidad de ${row.patientName}`}
                className="rounded-lg border border-teal-200 px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-50"
              >
                Revisar
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    {!rows.length && (
      <p className="p-8 text-center text-slate-500">No hay pacientes para este día y filtro.</p>
    )}
  </div>
);
