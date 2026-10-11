import { cudyrCensusAccepted } from '@/services/cudyr/cudyrCensusApproval';
import { CudyrCensusApprovalButton } from './CudyrCensusApprovalButton';
import { CheckCircle2, CircleAlert, Database, Info, RefreshCw } from 'lucide-react';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import { cudyrMomentLabel } from '@/services/cudyr/cudyrReportPresentation';
import { cudyrArchiveCoverage } from '@/services/cudyr/cudyrArchiveCoverage';

export const CudyrArchiveStatus = ({
  data,
  busy,
  error,
  canApprove = false,
  onApproved,
}: {
  data: CudyrReportDataset;
  busy: boolean;
  error: string;
  canApprove?: boolean;
  onApproved?: () => void;
}) => {
  const days = cudyrArchiveCoverage(data, new Date(data.generatedAt));
  const closed = days.filter(day => day.state !== 'open');
  const complete = closed.filter(day => day.state === 'complete').length;
  const pending = closed.length - complete;
  const open = days.length - closed.length;
  const censusPending = closed.filter(
    d => !cudyrCensusAccepted(data.coverage.find(c => c.date === d.date))
  ).length;
  const approved = data.coverage.length > 0 && data.coverage.every(d => d.reconstructionApproval);
  const approval = data.coverage.find(d => d.reconstructionApproval)?.reconstructionApproval;
  const originalDifferences = closed.filter(d => d.censusState !== 'verified').length;
  return (
    <details className="group rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
      <summary
        className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 [&::-webkit-details-marker]:hidden"
        aria-label="Estado del archivo CUDYR"
      >
        <span className="inline-flex items-center gap-1.5 font-medium text-teal-800">
          {pending || !closed.length ? (
            <Info size={14} aria-hidden="true" />
          ) : (
            <CheckCircle2 size={14} aria-hidden="true" />
          )}
          CUDYR verificados · {complete}/{closed.length} días
        </span>
        {censusPending > 0 && (
          <span className="inline-flex items-center gap-1.5 text-amber-800">
            <CircleAlert size={14} aria-hidden="true" />
            Pacientes del censo por confirmar
          </span>
        )}
        {pending > 0 && (
          <span className="text-amber-800">
            {pending} {pending === 1 ? 'día pendiente' : 'días pendientes'}
          </span>
        )}
        {open > 0 && <span>{open} en plazo</span>}
        <span className="ml-auto inline-flex items-center gap-1.5 text-slate-500">
          {busy ? (
            <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
          ) : (
            <Database size={12} aria-hidden="true" />
          )}
          {busy
            ? 'Actualizando…'
            : error
              ? 'Copia local · sin conexión confirmada'
              : data.officialSnapshot
                ? 'Oficial · guardado en HHR'
                : approved
                  ? 'Copia oficial pendiente'
                  : 'Datos consultados en HHR'}
          <Info size={14} aria-hidden="true" />
          <span className="sr-only">Ver detalle de verificación</span>
        </span>
      </summary>
      <div className="mt-3 space-y-2 border-t border-slate-100 pt-2">
        <ul className="list-disc space-y-1 pl-4">
          <li>
            <strong>CUDYR:</strong> confirma si hay registro en Eloísa.
          </li>
          <li>
            <strong>Censo HHR para CUDYR:</strong>{' '}
            {approved
              ? `reconstrucción aprobada por ${approval?.approvedBy} el ${cudyrMomentLabel(approval?.approvedAt || '')}.`
              : 'población aún sin aprobación de reconstrucción.'}
            {censusPending > 0 && <> {censusPending} días pendientes de cierre.</>}
          </li>
        </ul>
        {originalDifferences > 0 && (
          <details className="text-slate-500">
            <summary className="cursor-pointer">Nota del cotejo original con Eloísa</summary>
            <p className="mt-1">
              {originalDifferences} días presentan diferencias entre el censo HHR y el informe
              «Censo diario de pacientes» de Gestión de Camas de Eloísa. El informe histórico de
              Eloísa puede omitir pacientes.{' '}
              {approved
                ? 'Esta diferencia se conserva como antecedente y no deja pendiente el censo HHR reconstruido y aprobado.'
                : 'El cierre puede sustentarse en la reconstrucción documental, aunque los informes no coincidan.'}
            </p>
          </details>
        )}
        {canApprove &&
          onApproved &&
          !data.officialSnapshot &&
          !pending &&
          !open &&
          !busy &&
          !error && <CudyrCensusApprovalButton data={data} onApproved={onApproved} />}
        <p className="text-slate-500">
          Última lectura: {cudyrMomentLabel(data.loadedAt || data.generatedAt)}
        </p>
        <div className="max-h-44 overflow-y-auto rounded border border-slate-100">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1 font-medium">Día</th>
                <th className="px-2 py-1 font-medium">CUDYR</th>
                <th className="px-2 py-1 font-medium">Censo HHR · CUDYR</th>
                <th className="px-2 py-1">
                  <span className="sr-only">Detalle</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {days.map(day => (
                <tr key={day.date} className="border-t border-slate-100 align-top">
                  <td className="whitespace-nowrap px-2 py-1 tabular-nums">
                    {day.date.split('-').reverse().join('-')}
                  </td>
                  <td
                    className={`px-2 py-1 ${day.state === 'pending' ? 'text-amber-800' : 'text-slate-600'}`}
                  >
                    {day.state === 'complete'
                      ? 'Verificado'
                      : day.state === 'open'
                        ? 'En plazo'
                        : 'Pendiente'}
                  </td>
                  <td className="px-2 py-1">
                    {day.state === 'open'
                      ? 'En curso'
                      : data.coverage.find(d => d.date === day.date)?.reconstructionApproval
                        ? 'Reconstruido · aprobado'
                        : day.censusState === 'verified'
                          ? 'Completo'
                          : 'Por confirmar'}
                  </td>
                  <td className="px-2 py-1">
                    <details>
                      <summary
                        className="cursor-pointer list-none [&::-webkit-details-marker]:hidden"
                        aria-label={`Detalle del ${day.date}`}
                        title="Ver detalle del día"
                      >
                        <Info size={13} aria-hidden="true" />
                      </summary>
                      <p className="mt-1 max-w-md">{day.reason}</p>
                      {day.state !== 'open' && (
                        <p className="mt-1 max-w-md">
                          {data.coverage.find(d => d.date === day.date)?.censusVerification
                            ?.reason || 'Sin cotejo automático con el informe censal de Eloísa.'}
                        </p>
                      )}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
};
