import { useState } from 'react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import { cudyrControlStatus, cudyrEligibilityOrigin } from '@/services/cudyr/cudyrDailyControl';
import { cudyrMomentLabel } from '@/services/cudyr/cudyrReportPresentation';

export const CudyrExcludedCasesDialog = ({
  label,
  rows,
  initiallyWithCudyr,
  onClose,
}: {
  label: string;
  rows: CudyrReportRow[];
  initiallyWithCudyr: boolean;
  onClose: () => void;
}) => {
  const [withCudyr, setWithCudyr] = useState(initiallyWithCudyr);
  const visible = rows
    .filter(row => !withCudyr || row.evaluation !== null)
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.patientName.localeCompare(b.patientName, 'es')
    );
  return (
    <BaseModal isOpen onClose={onClose} title={`No elegibles · ${label}`} size="5xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <p>{visible.length} pacientes-día · Una fila por paciente y fecha del censo.</p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={withCudyr}
            onChange={event => setWithCudyr(event.target.checked)}
          />
          Solo con CUDYR
        </label>
      </div>
      <div className="overflow-x-auto">
        <table
          className="w-full min-w-[820px] text-left text-xs"
          aria-label={`Casos excluidos: ${label}`}
        >
          <thead className="border-b bg-slate-50 text-slate-500">
            <tr>
              {[
                'Fecha censo',
                'Paciente',
                'RUT / documento',
                'Cama · Eloísa',
                'CUDYR',
                'Registrado por',
                'Fecha y hora · Rapa Nui',
              ].map(title => (
                <th key={title} scope="col" className="px-2 py-2 font-medium">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map(row => (
              <tr key={row.key} className="border-b border-slate-100 align-top hover:bg-teal-50/40">
                <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                  {row.date.split('-').reverse().join('-')}
                </td>
                <td className="px-2 py-2 font-medium text-slate-900">{row.patientName}</td>
                <td className="whitespace-nowrap px-2 py-2">{row.rut || 'No informado'}</td>
                <td className="px-2 py-2">{row.bedName || row.bedId || '—'}</td>
                <td className="px-2 py-2">
                  <div className={row.evaluation ? 'font-medium text-teal-800' : 'text-slate-600'}>
                    {row.evaluation
                      ? `Registrado · ${row.evaluation.category}`
                      : cudyrControlStatus(row)}
                  </div>
                  {row.evaluation && (
                    <div className="mt-0.5 text-[10px] text-slate-500">
                      DEP {row.evaluation.dependencyScore ?? '—'} · Riesgo{' '}
                      {row.evaluation.riskScore ?? '—'}
                    </div>
                  )}
                  <details className="mt-1 text-[10px] text-slate-500">
                    <summary className="cursor-pointer">Origen y exclusión</summary>
                    <p>
                      {row.eligibilityReason} · {cudyrEligibilityOrigin(row)}
                    </p>
                    {row.evaluation && (
                      <p>
                        {row.monthlyEvidence?.state === 'found'
                          ? 'Eloísa · Gestión de Camas · Excel de categorización'
                          : row.evaluation.source || 'Eloísa'}
                      </p>
                    )}
                  </details>
                </td>
                <td className="px-2 py-2">
                  {row.evaluation ? row.evaluation.author || 'No informado' : '—'}
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {row.evaluation
                    ? row.evaluation.recordedAt
                      ? cudyrMomentLabel(row.evaluation.recordedAt)
                      : 'No informada'
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && (
          <p className="py-6 text-center text-sm text-slate-500">No hay casos con este filtro.</p>
        )}
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        Todos estos casos están excluidos del cumplimiento. Autor y hora solo se muestran si Eloísa
        los informa.
      </p>
    </BaseModal>
  );
};
