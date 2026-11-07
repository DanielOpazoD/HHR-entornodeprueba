import { lazy, Suspense, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { useAuth } from '@/context/AuthContext';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';
import { useCensusLaboratoryInbox } from '../hooks/useCensusLaboratoryInbox';
import type { CensusLabEntry, CensusLabPatient } from '@/services/laboratory/syslabJobs';
const ReportPdf = lazy(() =>
  import('./LabViewerPdf').then(module => ({ default: module.LabViewerPdf }))
);

interface Props {
  patients: CensusLabPatient[];
  censusDate: string;
  excluded: number;
  onClose: () => void;
}
const buttonClass =
  'min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50';
const stamp = (value: string) =>
  new Intl.DateTimeFormat('es-CL', {
    timeZone: CLINICAL_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
const statuses = {
  queued: 'En cola',
  running: 'En curso',
  completed: 'Completado',
  partial: 'Con pendientes',
  failed: 'No completado',
  cancelled: 'Cancelado',
};

/** Changing person, role, session or cohort mounts a fresh reader, never another person's inbox. */
export const CensusLaboratoryInbox = (props: Props) => {
  const { currentUser } = useAuth();
  const epoch = useSessionEpoch();
  const scope = JSON.stringify([
    currentUser?.uid,
    currentUser?.role,
    epoch,
    props.censusDate,
    props.patients.map(patient => [patient.rutBody, patient.episodeId, patient.admissionDate]),
  ]);
  return <InboxContent key={scope} {...props} scope={scope} />;
};

const InboxContent = ({
  patients,
  censusDate,
  excluded,
  onClose,
  scope,
}: Props & { scope: string }) => {
  const [pages, setPages] = useState([0]);
  const offset = pages[pages.length - 1];
  const [onlyUnread, setOnlyUnread] = useState(true);
  const [force, setForce] = useState(false);
  const [selected, setSelected] = useState<CensusLabEntry | null>(null);
  const [showPdf, setShowPdf] = useState(false);
  const inbox = useCensusLaboratoryInbox({ patients, censusDate, offset, onlyUnread }, scope);
  const data = inbox.state.data;
  const entries = data?.entries.filter(entry => !onlyUnread || !entry.reviewedAt) || [];
  const activeJob = data?.jobs.find(job => job.status === 'queued' || job.status === 'running');
  const error =
    inbox.state.error || inbox.update.error || inbox.jobAction.error || inbox.review.error;
  const names = new Map(
    patients.map(patient => [`${patient.rutBody}:${patient.episodeId}`, patient])
  );

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title="Resultados nuevos del censo"
      icon={<FlaskConical size={20} />}
      size="5xl"
      dataTestId="census-laboratory-inbox"
    >
      <div className="space-y-4 text-sm text-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">
              {patients.length} pacientes · Censo {censusDate}
            </p>
            <p className="text-xs text-slate-500">
              Desde el día de ingreso de cada episodio hasta el día seleccionado. Revisión personal.
            </p>
          </div>
          <button
            className="min-h-9 rounded-lg border border-teal-700 bg-teal-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:opacity-50"
            disabled={!patients.length || Boolean(activeJob) || inbox.update.isPending}
            onClick={() => inbox.update.mutate(force)}
          >
            {inbox.update.isPending ? 'Enviando…' : 'Actualizar exámenes del censo'}
          </button>
        </div>
        {excluded > 0 && (
          <p className="text-xs text-slate-600">
            {excluded} pacientes excluidos por no tener RUN válido, episodio o fecha de ingreso
            verificables. No se usa el RUN de otra persona.
          </p>
        )}
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={force}
            onChange={event => setForce(event.target.checked)}
          />
          Volver a leer también los informes conocidos para comprobar correcciones
        </label>
        <p className="text-xs text-slate-500">
          La primera actualización reúne los informes disponibles sin revisar. Las siguientes buscan
          órdenes nuevas o con cambios de validación. El trabajo continúa en el Mac mini al cerrar
          esta ventana.
        </p>
        {error && (
          <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p>{error.message}</p>
            <button
              className="mt-2 underline"
              onClick={() => {
                inbox.update.reset();
                inbox.jobAction.reset();
                inbox.review.reset();
                void inbox.state.refetch();
              }}
            >
              Volver a consultar la bandeja
            </button>
          </div>
        )}
        {inbox.state.isPending && patients.length > 0 && (
          <p role="status">Consultando la cola del Mac mini…</p>
        )}
        {data?.jobs.slice(0, 3).map(job => (
          <div key={job.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p role="status">
                <b>{statuses[job.status]}</b> · {job.completed} de {job.total} pacientes ·{' '}
                {stamp(job.createdAt)}
              </p>
              {(job.status === 'queued' || job.status === 'running') && (
                <button
                  className={buttonClass}
                  disabled={inbox.jobAction.isPending}
                  onClick={() => inbox.jobAction.mutate({ id: job.id, action: 'cancel' })}
                >
                  Cancelar trabajo
                </button>
              )}
              {['failed', 'partial', 'cancelled'].includes(job.status) && (
                <button
                  className={buttonClass}
                  disabled={Boolean(activeJob) || inbox.jobAction.isPending}
                  onClick={() => inbox.jobAction.mutate({ id: job.id, action: 'retry' })}
                >
                  Reintentar pendientes
                </button>
              )}
            </div>
            {job.reportProgress && job.status === 'running' && (
              <p className="mt-1 text-xs">
                {names.get(job.reportProgress.subjectKey)?.bedLabel || 'Paciente'} ·{' '}
                {job.reportProgress.completed} de {job.reportProgress.total} informes comprobados
              </p>
            )}
            {!!job.errors.length && <p className="mt-1 text-xs text-amber-800">{job.errors[0]}</p>}
            {!!job.patients.length && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer">Estado por paciente</summary>
                <ul className="mt-1 space-y-1">
                  {job.patients.map(patient => (
                    <li key={patient.subjectKey}>
                      {names.get(patient.subjectKey)?.bedLabel || 'Episodio anterior'} ·{' '}
                      {patient.status === 'ready'
                        ? `${patient.reports} informes listados${patient.pending ? ` · ${patient.pending} sin resultados aún` : ''} · ${patient.checkedAt ? stamp(patient.checkedAt) : ''}`
                        : 'No actualizado; se conserva lo conocido'}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
          <h3 className="font-semibold">
            {data?.unread ?? 0} {data?.unread === 1 ? 'informe' : 'informes'} sin revisar
          </h3>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlyUnread}
              onChange={event => {
                setOnlyUnread(event.target.checked);
                setPages([0]);
              }}
            />
            Solo sin revisar
          </label>
        </div>
        {data && !entries.length && (
          <p className="py-3 text-slate-500">
            No hay informes en esta página con el filtro seleccionado.
            {!data.jobs.length ? ' Pulsa Actualizar exámenes del censo para consultar Syslab.' : ''}
          </p>
        )}
        <ul className="space-y-2">
          {entries.map(entry => {
            const patient = names.get(entry.subjectKey);
            return (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words font-semibold">
                    {patient?.bedLabel} · {patient?.patientName}
                  </p>
                  <p className="text-xs">
                    Orden {entry.exam.id} · {entry.exam.date} {entry.exam.time} ·{' '}
                    {entry.exam.exams.join(', ')}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {entry.reviewedAt
                      ? `Revisado ${stamp(entry.reviewedAt)}`
                      : `Detectado ${stamp(entry.detectedAt)} · Sin revisar`}
                  </p>
                </div>
                <button
                  className={buttonClass}
                  onClick={() => {
                    setSelected(entry);
                    setShowPdf(false);
                  }}
                >
                  Ver resultado
                </button>
              </li>
            );
          })}
        </ul>
        {(offset > 0 || (data?.nextOffset !== null && data?.nextOffset !== undefined)) && (
          <nav aria-label="Páginas de resultados" className="flex justify-between gap-3">
            <button
              className={buttonClass}
              disabled={!offset}
              onClick={() => {
                setPages(current => current.slice(0, -1));
                setSelected(null);
              }}
            >
              Anterior
            </button>
            <button
              className={buttonClass}
              disabled={data?.nextOffset === null || data?.nextOffset === undefined}
              onClick={() => {
                setPages(current => [...current, data?.nextOffset || 0]);
                setSelected(null);
              }}
            >
              Siguiente
            </button>
          </nav>
        )}
        {selected && (
          <section
            aria-label="Detalle del resultado"
            className="rounded-xl border border-teal-200 bg-teal-50/40 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">
                {names.get(selected.subjectKey)?.patientName} · Orden {selected.exam.id}
              </h3>
              <button className={buttonClass} onClick={() => setSelected(null)}>
                Cerrar resultado
              </button>
            </div>
            <div className="my-3 max-h-80 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>
                    <th className="p-2">Análisis</th>
                    <th className="p-2">Resultado</th>
                    <th className="p-2">Referencia</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.findings.map((finding, index) => (
                    <tr key={index} className="border-t border-slate-200">
                      <td className="p-2">
                        {finding.analysis}
                        <span className="block text-[10px] text-slate-500">{finding.section}</span>
                      </td>
                      <td className="p-2">
                        {finding.result} {finding.unit}
                      </td>
                      <td className="p-2">{finding.refValue || 'No informada'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!selected.findings.length && (
                <p className="p-2">
                  No se extrajeron valores estructurados. Revisa el PDF original.
                </p>
              )}
            </div>
            {showPdf && (
              <Suspense fallback={<p role="status">Abriendo PDF…</p>}>
                <ReportPdf exam={selected.exam} onBack={() => setShowPdf(false)} />
              </Suspense>
            )}
            <div className="flex flex-wrap gap-2">
              <button className={buttonClass} onClick={() => setShowPdf(true)}>
                Abrir PDF original
              </button>
              <button
                className={buttonClass}
                disabled={Boolean(selected.reviewedAt) || inbox.review.isPending}
                onClick={() => {
                  inbox.review.mutate(selected, { onSuccess: () => setSelected(null) });
                }}
              >
                Marcar revisado
              </button>
            </div>
          </section>
        )}
      </div>
    </BaseModal>
  );
};
