import type { ArchivedCudyrSupplement } from '@/services/cudyr/cudyrSupplementService';
import { CudyrSupplementDetail } from './CudyrSupplementDetail';
import { BaseModal } from '@/components/shared/BaseModal';
import type { CudyrReportDataset, CudyrReportRow } from '@/types/domain/cudyrReport';
import {
  CUDYR_GROUP_LABELS,
  CUDYR_MODALITY_LABELS,
  CUDYR_ELIGIBILITY_LABELS,
  CUDYR_STATUS_LABELS,
  cudyrMomentLabel,
  cudyrSystemDischargeLabel,
} from '@/services/cudyr/cudyrReportPresentation';

const Facts = ({ values }: { values: Array<[string, string | number | undefined]> }) => (
  <dl className="grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2">
    {values.map(([label, value]) => (
      <div key={label}>
        <dt className="text-xs text-slate-500">{label}</dt>
        <dd className="mt-0.5 break-words text-sm font-medium text-slate-900">
          {value === undefined || value === '' ? 'No informado' : value}
        </dd>
      </div>
    ))}
  </dl>
);
export const CudyrReportDetail = ({
  row,
  data,
  canEdit,
  supplements = [],
  supplementsReady = true,
  onClose,
  onCorrect,
}: {
  row: CudyrReportRow;
  data: CudyrReportDataset;
  canEdit: boolean;
  supplements?: ArchivedCudyrSupplement[];
  supplementsReady?: boolean;
  onClose: () => void;
  onCorrect: () => void;
}) => {
  const observations = data.observations.filter(
    item =>
      Boolean(row.clinicalEpisodeId) &&
      item.evaluation.clinicalEpisodeId === row.clinicalEpisodeId &&
      item.censusDate === row.date
  );
  const captures = data.captures.filter(
    item =>
      Boolean(row.clinicalEpisodeId) && item.capture.clinicalEpisodeId === row.clinicalEpisodeId
  );
  const audit = data.dischargeAudit
    .filter(
      item => Boolean(row.clinicalEpisodeId) && item.clinicalEpisodeId === row.clinicalEpisodeId
    )
    .sort((a, b) => b.revision - a.revision);
  const actual = row.correction?.actualDischarge;
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title="Detalle diario CUDYR"
      size="xl"
      dataTestId="cudyr-report-detail"
    >
      <div className="space-y-5">
        <div className="border-b pb-3">
          <p className="text-lg font-bold text-slate-900">{row.patientName}</p>
          <p className="text-sm text-slate-600">
            {row.rut || 'Documento no informado'} · Día censal {row.date} ·{' '}
            {row.bedId || 'Cama por aclarar'}
          </p>
        </div>
        <Facts
          values={[
            ['Diagnóstico', row.diagnosis],
            ['CIE-10', row.diagnosisCode],
            ['Episodio', row.clinicalEpisodeId],
            [
              'Identidad y diagnóstico observados en',
              row.identitySource + ' · ' + row.identitySourceDate,
            ],
            ['Ingreso', row.admissionDate + ' ' + row.admissionTime],
            ['Servicio', row.service],
            ['Grupo estadístico', CUDYR_GROUP_LABELS[row.group]],
            ['Modalidad', CUDYR_MODALITY_LABELS[row.modality]],
            ['Elegibilidad', CUDYR_ELIGIBILITY_LABELS[row.eligibility]],
            ['Motivo', row.eligibilityReason],
            ['Contexto de cama', row.contextSource],
            ['Instante de referencia · Rapa Nui', cudyrMomentLabel(row.referenceAt)],
          ]}
        />
        <section className="rounded-lg bg-teal-50 p-4">
          <h3 className="mb-3 font-semibold text-teal-950">Evaluación seleccionada</h3>
          <Facts
            values={[
              ['Estado', CUDYR_STATUS_LABELS[row.cudyrStatus]],
              ['Categoría', row.evaluation?.category],
              ['Autor CUDYR', row.evaluation?.author],
              [
                'Rol / ID autor',
                [row.evaluation?.authorRole, row.evaluation?.authorId].filter(Boolean).join(' / '),
              ],
              ['Fecha y hora · Rapa Nui', cudyrMomentLabel(row.evaluation?.recordedAt || '')],
              ['Fecha y hora original', row.evaluation?.recordedAt],
              ['Fuente', row.evaluation?.source],
              [
                'Dependencia / riesgo',
                row.evaluation
                  ? (row.evaluation.dependencyScore ?? '—') +
                    ' / ' +
                    (row.evaluation.riskScore ?? '—')
                  : '',
              ],
              ['Evento en origen', row.evaluation?.sourceEvaluationId],
              ['Aplicaciones distintas observadas', row.evaluationCount],
            ]}
          />
        </section>
        <section>
          <h3 className="mb-3 font-semibold">Captura y guardado</h3>
          <Facts
            values={[
              ['Última captura · Rapa Nui', cudyrMomentLabel(row.lastCaptureAt)],
              ['Persistido · Rapa Nui', cudyrMomentLabel(row.lastPersistedAt)],
              ['Usuario sincronizador', row.captureActor],
              ['Ejecución origen', row.sourceRunId],
              ['Guardado diario HHR por', row.dailyCudyrSavedBy],
              ['Guardado diario · Rapa Nui', cudyrMomentLabel(row.dailyCudyrSavedAt)],
            ]}
          />
        </section>
        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="mb-3 font-semibold">Egreso y alta real</h3>
          <Facts
            values={[
              ['Egreso informado por el sistema', cudyrSystemDischargeLabel(row)],
              [
                'Alta física verificada · Rapa Nui',
                actual
                  ? actual.date + ' ' + (actual.time || '(hora desconocida)')
                  : 'Sin verificación',
              ],
              ['Revisión por', row.correction?.updatedBy.name],
              ['Fecha de revisión', cudyrMomentLabel(row.correction?.updatedAt || '')],
              ['Motivo de revisión', row.correction?.reason],
              [
                'Epicrisis médica / enfermería',
                [row.medicalEpicrisisStatus, row.nursingEpicrisisStatus]
                  .filter(Boolean)
                  .join(' / '),
              ],
              ['Registro epicrisis · Rapa Nui', cudyrMomentLabel(row.epicrisisRegisteredAt)],
            ]}
          />
          {canEdit && row.clinicalEpisodeId && (
            <button
              type="button"
              onClick={onCorrect}
              className="mt-4 rounded-lg border border-teal-700 px-3 py-2 text-sm font-semibold text-teal-800"
            >
              Verificar o corregir alta real
            </button>
          )}
        </section>
        {row.warnings.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <ul className="list-disc space-y-1 pl-4">
              {row.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        <CudyrSupplementDetail reports={supplements} document={row.rut} ready={supplementsReady} />
        {!row.evaluation?.observationId && Boolean(row.evaluation?.items?.length) && (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer font-medium">Ítems de la evaluación diaria</summary>
            <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {row.evaluation?.items?.map(item => (
                <div key={item.fieldId} className="flex justify-between gap-3 text-sm">
                  <dt>{item.label || item.fieldId}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer font-medium">
            Aplicaciones, versiones e ítems ({observations.length})
          </summary>
          {observations.length === 0 ? (
            <p className="mt-2 text-sm">No hay observaciones archivadas para este día.</p>
          ) : (
            observations.map(item => (
              <article key={item.id} className="mt-3 border-t pt-3 text-sm">
                <p className="font-semibold">
                  {item.evaluation.category} · {cudyrMomentLabel(item.evaluation.recordedAt)}
                  {item.evaluation.isDeleted ? ' · Anulado' : ''}
                </p>
                <p>
                  {item.evaluation.author || 'Autor no informado'} ·{' '}
                  {item.evaluation.authorRole || 'Rol no informado'}
                </p>
                <p className="break-all text-xs text-slate-500">
                  Evento {item.evaluation.sourceEvaluationId} · Observación {item.id}
                </p>
                <dl className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {(item.evaluation.items || []).map(field => (
                    <div key={field.fieldId} className="flex justify-between gap-3">
                      <dt>{field.label || field.fieldId}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))
          )}
        </details>
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer font-medium">
            Capturas guardadas ({captures.length})
          </summary>
          {captures.map(capture => (
            <div key={capture.id} className="mt-3 border-t pt-2 text-sm">
              <p>
                Censo {capture.censusDate} · {capture.capture.status} · metadatos{' '}
                {capture.capture.metadataStatus}
              </p>
              <p>
                Capturado {cudyrMomentLabel(capture.capture.observedAt)} · Persistido{' '}
                {cudyrMomentLabel(capture.receivedAt)}
              </p>
              <p>
                {capture.receivedBy} · Parte {capture.capture.part + 1} de{' '}
                {capture.capture.totalParts}
              </p>
              <p className="break-all text-xs text-slate-500">
                Recibo {capture.id} · Ejecución {capture.capture.sourceRunId}
              </p>
            </div>
          ))}
        </details>
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer font-medium">
            Camas observadas e intervalos de origen
          </summary>
          {captures.flatMap(capture =>
            (capture.capture.sourcePlacements || []).map((p, index) => (
              <div key={capture.id + ':' + index} className="mt-3 border-t pt-2 text-sm">
                <p className="font-medium">
                  {p.sourceBedLabel || p.bedId} · {p.sourceDepartmentLabel} · {p.modality}
                </p>
                <p className="break-all">
                  Inicio {p.sourceStartAt} · Fin {p.sourceEndAt}
                </p>
                <p>
                  Capturado {cudyrMomentLabel(capture.capture.observedAt)}
                  {p.isDeleted ? ' · Anulado' : ''}
                </p>
              </div>
            ))
          )}
        </details>
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer font-medium">
            Movimientos y registro del egreso ({row.movements.length})
          </summary>
          {row.movements.map((m, index) => (
            <div key={index} className="mt-3 border-t pt-2 text-sm">
              <p>
                {m.section} · {m.bedName || m.bedId} · {m.date || 'Fecha no informada'}{' '}
                {m.time || 'Hora no informada'}
              </p>
              <p>
                Registrado/clasificado {cudyrMomentLabel(m.recordedAt)} · {m.source}
              </p>
            </div>
          ))}
        </details>
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer font-medium">
            Auditoría del alta real ({audit.length})
          </summary>
          {audit.map(entry => (
            <div key={entry.id} className="mt-3 border-t pt-2 text-sm">
              <p>
                Revisión {entry.revision} ·{' '}
                {entry.actualDischarge
                  ? entry.actualDischarge.date + ' ' + (entry.actualDischarge.time || '(sin hora)')
                  : 'Fecha retirada'}
              </p>
              <p>
                {entry.updatedBy.name} · {cudyrMomentLabel(entry.updatedAt)}
              </p>
              <p>{entry.reason}</p>
            </div>
          ))}
        </details>
      </div>
    </BaseModal>
  );
};
