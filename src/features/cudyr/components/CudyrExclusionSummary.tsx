import { useState } from 'react';
import { CudyrExcludedCasesDialog } from './CudyrExcludedCasesDialog';
import { CircleMinus } from 'lucide-react';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import { cudyrExclusionSummary } from '@/services/cudyr/cudyrExclusionSummary';

export const CudyrExclusionSummary = ({ data }: { data: CudyrReportDataset }) => {
  const [selection, setSelection] = useState<{ key: string; withCudyr: boolean } | null>(null);
  const summary = cudyrExclusionSummary(data.rows);
  const selectedGroup = summary.groups.find(group => group.key === selection?.key);
  const linkClass =
    'rounded px-1 py-1 text-teal-800 underline decoration-teal-200 underline-offset-2 hover:bg-teal-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700';
  return (
    <>
      <details className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
          <CircleMinus size={13} aria-hidden="true" />
          No elegibles del mes · {summary.patientDays} pacientes-día · {summary.patients} pacientes
        </summary>
        <p className="mt-2 text-[11px]">
          Desde el día 1 hasta el {data.to.split('-').reverse().join('-')}. {summary.withCudyr}{' '}
          pacientes-día tienen CUDYR registrado y permanecen fuera del cumplimiento.
        </p>
        <table
          className="mt-2 w-full max-w-2xl text-left"
          aria-label="Desglose mensual de no elegibles"
        >
          <thead className="text-[11px] text-slate-500">
            <tr>
              <th className="font-medium">Motivo</th>
              <th className="text-right font-medium">Pacientes</th>
              <th className="text-right font-medium">Pacientes-día</th>
              <th className="text-right font-medium">Con CUDYR*</th>
            </tr>
          </thead>
          <tbody>
            {summary.groups.map(group => (
              <tr key={group.key} className="border-t border-slate-100">
                <td className="py-1">
                  <button
                    type="button"
                    className={linkClass}
                    onClick={() => setSelection({ key: group.key, withCudyr: false })}
                  >
                    {group.label}
                  </button>
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    className={linkClass}
                    aria-label={`Ver pacientes: ${group.label}`}
                    onClick={() => setSelection({ key: group.key, withCudyr: false })}
                  >
                    {group.patients}
                  </button>
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    className={linkClass}
                    aria-label={`Ver pacientes-día: ${group.label}`}
                    onClick={() => setSelection({ key: group.key, withCudyr: false })}
                  >
                    {group.patientDays}
                  </button>
                </td>
                <td className="text-right">
                  <button
                    type="button"
                    className={linkClass}
                    aria-label={`Ver con CUDYR: ${group.label}`}
                    onClick={() => setSelection({ key: group.key, withCudyr: true })}
                  >
                    {group.withCudyr}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[10px] text-slate-500">
          *Pacientes-día. Una persona puede aparecer en distintos motivos; no se suman los pacientes
          por motivo. Sin documento propio, se identifica por episodio. Altas, traslados y
          fallecimientos resueltos no se cuentan como exclusiones.
        </p>
      </details>
      {selectedGroup && selection && (
        <CudyrExcludedCasesDialog
          key={`${data.from}:${data.to}:${selectedGroup.key}:${selection.withCudyr}`}
          label={selectedGroup.label}
          rows={selectedGroup.rows}
          initiallyWithCudyr={selection.withCudyr}
          onClose={() => setSelection(null)}
        />
      )}
    </>
  );
};
