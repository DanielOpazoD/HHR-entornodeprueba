import { BaseModal } from '@/components/shared/BaseModal';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import { cudyrMomentLabel } from '@/services/cudyr/cudyrReportPresentation';

export const CudyrHistoricalSourceDialog = ({
  row,
  onClose,
}: {
  row: CudyrReportRow;
  onClose: () => void;
}) => (
  <BaseModal isOpen onClose={onClose} title="Fuente del CUDYR" size="md">
    <div className="space-y-3 text-sm">
      <p className="font-semibold">{row.patientName}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt>Eloísa</dt>
        <dd>Gestión de Camas → Informes → Categorización de riesgo dependencia</dd>
        <dt>Archivo</dt>
        <dd>Excel mensual · {row.monthlyEvidence?.sourceDate.slice(0, 7)}</dd>
        <dt>Turno HHR</dt>
        <dd>{row.date} · noche</dd>
        <dt>Día en Eloísa</dt>
        <dd>{row.monthlyEvidence?.sourceDate}</dd>
        <dt>Consultado el</dt>
        <dd>{cudyrMomentLabel(row.monthlyEvidence?.checkedAt || '')}</dd>
      </dl>
      <p className="rounded bg-teal-50 p-3 text-teal-900">
        {row.monthlyEvidence?.state === 'conflict'
          ? 'Datos en conflicto. Pendiente de aclarar.'
          : row.evaluation
            ? 'Resultado válido de Eloísa. Solo cuenta si el paciente es elegible.'
            : 'No registrado en el día consultado de Eloísa.'}
      </p>
      {row.verifiedContext && (
        <details className="rounded border border-teal-100 p-2">
          <summary>Respaldo de la conciliación</summary>
          <p className="mt-2">{row.verifiedContext.reason}</p>
          <p className="mt-2 text-xs text-slate-500">
            {row.verifiedContext.reviewedBy} · {cudyrMomentLabel(row.verifiedContext.reviewedAt)} ·
            Revisión {row.verifiedContext.revision}
          </p>
          {row.evaluation &&
            row.verifiedContext.applicationTimingBasis === 'assumed_before_0800' && (
              <p className="mt-2 text-xs">
                Sin hora original: asociado a la madrugada anterior a las 08:00, sin asignar una
                hora exacta.
              </p>
            )}
        </details>
      )}
      <p className="text-xs text-slate-500">
        «Consultado el» indica cuándo se recuperó el archivo, no cuándo se aplicó CUDYR.
      </p>
    </div>
  </BaseModal>
);
