import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { downloadBlob } from '@/services/exporters/exportDownload';
import {
  auditClock,
  withinAdmissionHistory,
  groupAdmissionAuthors,
  type AdmissionPeriod,
  type IndicationScope,
} from './admissionAuditModel';
import { useAdmissionAudit } from './useAdmissionAudit';
import { buildAdmissionAuditBook } from './admissionAuditBook';
import { AdmissionAuditDetails } from './AdmissionAuditDetails';

const control =
  'min-h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 disabled:opacity-50';
const button =
  'min-h-9 rounded-md bg-teal-700 px-3 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700';

export const AdmissionAuditView = () => {
  const { currentUser } = useAuth();
  const owner = currentUser?.role === 'admin' ? currentUser.uid : null;
  const audit = useAdmissionAudit(owner);
  const today = getClinicalCalendarDateISO();
  const [period, setPeriod] = useState<AdmissionPeriod>({ from: today, to: today });
  const [indicationScope, setIndicationScope] = useState<IndicationScope>('first-set');
  const [doctor, setDoctor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');
  if (!owner)
    return (
      <p role="alert" className="p-6 text-sm text-slate-600">
        Este panel está disponible sólo para administrador.
      </p>
    );
  const report = audit.report;
  const authors = groupAdmissionAuthors(report?.entries ?? []);
  const chosenDoctor = doctor && authors.some(a => a.name === doctor) ? doctor : null;
  const visible = (report?.entries ?? []).filter(
    entry => !chosenDoctor || entry.doctor === chosenDoctor
  );
  const active = visible.find(entry => entry.patient.key === selected) ?? visible[0];
  const invalid =
    !auditClock(period.from) ||
    !auditClock(period.to) ||
    !withinAdmissionHistory(period.from) ||
    period.from > period.to ||
    period.to > today;
  const changed =
    report &&
    (report.period.from !== period.from ||
      report.period.to !== period.to ||
      report.indicationScope !== indicationScope);
  const errors = report?.entries.filter(e => e.readError || e.vitalReadError).length ?? 0;
  const canDownload = visible.some(e => !e.readError) && !changed && !audit.running && !audit.error;
  const download = () => {
    if (!report || !canDownload) return;
    try {
      downloadBlob(
        new Blob([buildAdmissionAuditBook(report, chosenDoctor)], {
          type: 'text/html;charset=utf-8',
        }),
        `Ingresos_medicos_${report.period.from}_${report.period.to}.html`
      );
      setDownloadError('');
    } catch {
      setDownloadError('No se pudo generar el libro. Vuelve a intentarlo.');
    }
  };
  return (
    <main className="mx-auto max-w-[1400px] p-4 md:p-6" aria-label="Auditoría de ingresos médicos">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">Ingresos médicos</h1>
        <p className="mt-1 text-sm text-slate-500">
          Auditoría por autor de la primera evolución médica vigente. Hospitalizaciones registradas
          en HHR, incluidas las ya egresadas.
        </p>
      </header>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={event => {
          event.preventDefault();
          if (!invalid) {
            setDoctor(null);
            setSelected(null);
            void audit.start(period, indicationScope);
          }
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Desde
          <input
            type="date"
            aria-label="Desde"
            value={period.from}
            max={today}
            disabled={audit.running}
            onChange={e => setPeriod(p => ({ ...p, from: e.target.value }))}
            className={control}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Hasta
          <input
            type="date"
            aria-label="Hasta"
            value={period.to}
            max={today}
            disabled={audit.running}
            onChange={e => setPeriod(p => ({ ...p, to: e.target.value }))}
            className={control}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Primeras indicaciones
          <select
            aria-label="Criterio de primeras indicaciones"
            value={indicationScope}
            disabled={audit.running}
            onChange={e =>
              setIndicationScope(e.target.value === 'first-set' ? 'first-set' : 'first-day')
            }
            className={control}
          >
            <option value="first-set">Primer conjunto a la misma hora</option>
            <option value="first-day">Ampliar al primer día con indicaciones</option>
          </select>
        </label>
        <button className={button} disabled={invalid || audit.running} type="submit">
          {audit.running ? 'Consultando…' : 'Consultar ingresos'}
        </button>
        {audit.running && (
          <button className={control} type="button" onClick={audit.cancel}>
            Cancelar
          </button>
        )}
        <button
          type="button"
          className={`${control} ml-auto`}
          disabled={!canDownload}
          onClick={download}
        >
          Descargar libro HTML{errors ? ' (lectura parcial)' : ''}
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500">
        El libro incluye índice por médico e ingreso y permite imprimir o guardar como PDF. Se
        agrupa por el nombre de autor registrado en Eloísa.
      </p>
      {invalid && (
        <p role="alert" className="mt-2 text-sm text-amber-800">
          Elige un período válido hasta hoy, dentro de la cobertura de 4000 días.
        </p>
      )}
      {audit.progress && (
        <p role="status" className="mt-3 text-sm text-slate-600">
          {audit.progress}
        </p>
      )}
      {audit.error && (
        <p role="alert" className="mt-3 text-sm text-amber-800">
          {audit.error}
        </p>
      )}
      {downloadError && (
        <p role="alert" className="mt-3 text-sm text-amber-800">
          {downloadError}
        </p>
      )}
      {changed && (
        <p role="status" className="mt-3 text-sm text-amber-800">
          Los controles cambiaron. Consulta de nuevo para aplicar el período y criterio; el
          resultado visible conserva su selección original.
        </p>
      )}
      {report ? (
        <>
          <p className="my-4 text-sm text-slate-600">
            {formatDateDDMMYYYY(report.period.from)} al {formatDateDDMMYYYY(report.period.to)} ·{' '}
            {report.entries.length} hospitalizaciones
            {errors > 0 && ` · ${errors} sin lectura completa`}
          </p>
          {report.entries.length > 0 ? (
            <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
              <aside
                aria-label="Médicos y recuentos"
                className="rounded-lg border border-slate-200 bg-white p-2"
              >
                <button
                  className={`${control} mb-2 w-full text-left`}
                  aria-pressed={!chosenDoctor}
                  onClick={() => {
                    setDoctor(null);
                    setSelected(null);
                  }}
                >
                  Todos los autores
                </button>
                {authors.map(a => (
                  <button
                    key={a.name}
                    type="button"
                    aria-pressed={chosenDoctor === a.name}
                    onClick={() => {
                      setDoctor(a.name);
                      setSelected(null);
                    }}
                    className={`flex min-h-10 w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${chosenDoctor === a.name ? 'bg-teal-50 text-teal-900' : 'text-slate-700 hover:bg-slate-50'}`}
                  >
                    <span>{a.name}</span>
                    <span className="tabular-nums text-slate-500">
                      {a.name === 'Sin atribuir' ? a.total : a.count}
                    </span>
                  </button>
                ))}
                <p className="mt-3 px-2 text-xs text-slate-500">
                  Episodios con primera evolución atribuible al autor registrado.
                </p>
              </aside>
              <div className="min-w-0">
                <label className="mb-3 flex flex-col gap-1 text-xs text-slate-600">
                  Ingreso
                  <select
                    className={control}
                    aria-label="Elegir ingreso"
                    value={active?.patient.key ?? ''}
                    onChange={e => setSelected(e.target.value)}
                  >
                    {visible.map(e => (
                      <option key={e.patient.key} value={e.patient.key}>
                        {formatDateDDMMYYYY(e.patient.admissionDate)} · {e.patient.patientName}
                      </option>
                    ))}
                  </select>
                </label>
                {active && <AdmissionAuditDetails entry={active} />}
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
              No hay hospitalizaciones con fecha de ingreso y episodio identificables en los censos
              consultados para este período.
            </p>
          )}
        </>
      ) : (
        !audit.running && (
          <p className="mt-8 text-sm text-slate-500">
            Selecciona un período para revisar sus ingresos médicos.
          </p>
        )
      )}
    </main>
  );
};
