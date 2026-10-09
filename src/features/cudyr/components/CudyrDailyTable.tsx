import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import { CUDYR_GROUP_LABELS } from '@/services/cudyr/cudyrReportPresentation';
import { cudyrControlStatus } from '@/services/cudyr/cudyrDailyControl';

export const CudyrDailyTable = ({
  rows,
  onReview,
}: {
  rows: CudyrReportRow[];
  onReview: (key: string) => void;
}) => (
  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
    <table className="w-full min-w-[660px] table-fixed text-left text-xs">
      <caption className="px-3 py-2 text-left text-[11px] text-slate-500">
        Medias: NEO 1–2 y H1C1–H6C2 · Intermedias: R1–R4 · Seleccione Revisar para ver los
        antecedentes.
      </caption>
      <thead className="border-y bg-slate-50 text-[11px] text-slate-500">
        <tr>
          {[
            ['Cama', 'w-20'],
            ['Paciente', 'w-auto'],
            ['P. DEP', 'w-14'],
            ['P. RIESGO', 'w-16'],
            ['Categoría', 'w-16'],
            ['Estado', 'w-44'],
            ['Revisión', 'w-20'],
          ].map(([label, width]) => (
            <th key={label} scope="col" className={`px-2 py-2 font-medium ${width}`}>
              {label}
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
            <td className="truncate px-2 py-1 font-medium" title={CUDYR_GROUP_LABELS[row.group]}>
              {row.bedName || row.bedId || '—'}
            </td>
            <td
              className="truncate px-2 py-1 text-slate-900"
              title={`${row.patientName} · ${row.rut} · ${row.diagnosis}`}
            >
              {row.patientName}
            </td>
            <td className="px-2 py-1 tabular-nums text-blue-700">
              {row.evaluation?.dependencyScore ?? '—'}
            </td>
            <td className="px-2 py-1 tabular-nums text-rose-700">
              {row.evaluation?.riskScore ?? '—'}
            </td>
            <td className="px-2 py-1 font-semibold text-teal-800">
              {row.evaluation?.category || '—'}
            </td>
            <td className="truncate px-2 py-1 text-slate-600" title={row.eligibilityReason}>
              {row.eligibility === 'no_elegible'
                ? 'Excluido'
                : row.eligibility === 'por_revisar'
                  ? 'Por revisar'
                  : cudyrControlStatus(row)}
            </td>
            <td className="px-2 py-1">
              <button
                type="button"
                onClick={() => onReview(row.key)}
                aria-label={`Revisar elegibilidad de ${row.patientName}`}
                className="rounded px-2 py-0.5 text-xs font-medium text-teal-800 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
              >
                Revisar
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
);
