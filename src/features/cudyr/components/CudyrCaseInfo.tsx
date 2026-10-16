import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import { cudyrControlStatus, cudyrEligibilityOrigin } from '@/services/cudyr/cudyrDailyControl';
import { cudyrMomentLabel, cudyrResultOrigin } from '@/services/cudyr/cudyrReportPresentation';

export const CudyrCaseInfo = ({ row }: { row: CudyrReportRow }) => (
  <div className="rounded-lg bg-slate-50 p-3">
    <p>
      {row.rut} · {row.diagnosis || 'Diagnóstico no informado'}
    </p>
    <p className="mt-2 text-xs">
      Ingreso a hospitalización: {cudyrMomentLabel(row.hospitalAdmissionAt || '')}
      <br />
      {row.hospitalAdmissionSource}
      <br />
      Ingreso del episodio (puede incluir Urgencias): {row.admissionDate} {row.admissionTime}
      <br />
      Resultado recibido desde Eloísa: {cudyrMomentLabel(row.evaluationCapturedAt || '')}
    </p>
    <p className="mt-2">
      {cudyrControlStatus(row)} · {row.evaluation?.category || 'Sin categoría'}
    </p>
    <p className="text-xs text-slate-500">
      {row.evaluation?.author || 'Autor no informado'} ·{' '}
      {cudyrMomentLabel(row.evaluation?.recordedAt || '')}
      <br />
      Origen: {cudyrResultOrigin(row) || 'Sin resultado confirmado'}
      <br />
      Última consulta: {cudyrMomentLabel(row.lastCaptureAt)}
    </p>
    {row.monthlyEvidence?.linkMethod === 'episode_timeline' && (
      <p className="mt-2 text-xs text-slate-500">
        Histórico Eloísa vinculado por RUT, nombre y fechas de un único episodio. Fila{' '}
        {row.monthlyEvidence.sourceRow} del informe original.
      </p>
    )}
    {row.monthlyEvidence?.identityMatch === 'census_name_normalization' && (
      <p className="mt-2 text-xs text-slate-500">
        Nombre conciliado con el censo y el mismo documento. Nombre original en Eloísa:{' '}
        {row.monthlyEvidence.sourcePatientName}. Fila {row.monthlyEvidence.sourceRow} del informe.
      </p>
    )}
    {row.warnings.map(warning => (
      <p key={warning} className="mt-1 text-xs text-amber-800">
        {warning}
      </p>
    ))}
    <p>{row.eligibilityReason}</p>
    <p className="mt-2 text-xs text-slate-500">
      La excepción no elimina el CUDYR ni da de alta al paciente. La falta de epicrisis no demuestra
      una salida: documente la ubicación o salida efectiva.
    </p>
    <p className="mt-1 text-xs text-slate-500">{cudyrEligibilityOrigin(row)}</p>
    {row.exclusion && (
      <p className="mt-2">
        Última excepción: {row.exclusion.updatedBy.name} ·{' '}
        {cudyrMomentLabel(row.exclusion.updatedAt)}
        <br />
        {row.exclusion.note}
      </p>
    )}
  </div>
);
