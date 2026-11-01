import React, { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { calendarStampInClinicalTimeZone, CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';
import {
  previewDailyRecordRestore,
  restoreDailyRecord,
  type DailyRestoreSource,
  type DailyRestorePreview,
  type DailyRestoreResult,
  type DailyRestoreSummary,
} from '@/services/admin/dailyRecordRestoreService';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'preview'; source: DailyRestoreSource; value: DailyRestorePreview }
  | { kind: 'restoring' }
  | { kind: 'failed'; message: string }
  | { kind: 'restored'; value: DailyRestoreResult };
const stamp = (value: string) =>
  new Intl.DateTimeFormat('es-CL', {
    timeZone: CLINICAL_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value));
const Comparison = ({ title, value }: { title: string; value: DailyRestoreSummary }) => (
  <section className="min-w-0 rounded border p-3">
    <h3 className="font-bold">{title}</h3>
    <p>
      Último cambio: {stamp(value.lastUpdated)} · Versión {value.revision}
    </p>
    {(['occupiedBeds', 'clinicalCribs', 'discharges', 'transfers', 'cma'] as const).map(
      (key, index) => (
        <details key={key}>
          <summary>
            {['Camas ocupadas', 'Cunas clínicas', 'Altas', 'Traslados', 'CMA'][index]}:{' '}
            {value[key].length}
          </summary>
          <ul>
            {value[key].map((patient, i) => (
              <li key={i}>
                {patient.bedId} · {patient.patientName} · {patient.documentType} {patient.rut} ·
                Episodio {patient.clinicalEpisodeId || 'sin identificar'}
              </li>
            ))}
          </ul>
        </details>
      )
    )}
    <details>
      <summary>
        Documentos por episodio:{' '}
        {value.episodeDocuments.filter(doc => doc.currentGeneration).length} vigentes
      </summary>
      <ul>
        {value.episodeDocuments.map(doc => (
          <li key={doc.clinicalEpisodeId}>
            {doc.clinicalEpisodeId} · {doc.currentGeneration ? 'vigente' : 'otra generación'}
            {doc.lastUpdated ? ` · ${stamp(doc.lastUpdated)}` : ''}
          </li>
        ))}
      </ul>
    </details>
    {value.warnings.map(warning => (
      <p key={warning} className="font-semibold text-amber-900">
        Atención: {warning}
      </p>
    ))}
  </section>
);

export const DailyRecordRestorePanel = () => {
  const { currentUser } = useAuth();
  const now = calendarStampInClinicalTimeZone();
  const [date, setDate] = useState(now.iso);
  const [moment, setMoment] = useState(`${now.iso}T${now.hhmm}`);
  const [backupId, setBackupId] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const busy = state.kind === 'loading' || state.kind === 'restoring';
  if (currentUser?.role !== 'admin') return null;
  const preview = async (source: DailyRestoreSource) => {
    setState({ kind: 'loading' });
    setConfirmation('');
    try {
      setState({ kind: 'preview', source, value: await previewDailyRecordRestore(source) });
    } catch {
      setState({
        kind: 'failed',
        message:
          'No se pudo leer la comparación. El día puede no existir en ese momento o estar fuera de la ventana disponible. No se restauró ningún dato.',
      });
    }
  };
  const restore = async () => {
    if (state.kind !== 'preview' || confirmation !== state.source.date) return;
    const request = {
      ...state.source,
      confirmationDate: confirmation,
      expectedLastUpdated: state.value.current.lastUpdated,
    };
    setState({ kind: 'restoring' });
    try {
      setState({ kind: 'restored', value: await restoreDailyRecord(request) });
    } catch {
      setState({
        kind: 'failed',
        message:
          'No se confirmó la restauración. El censo pudo cambiar o la operación falló. Consulte nuevamente antes de continuar; si se perdió la conexión, compruebe también la auditoría.',
      });
    }
  };
  return (
    <section
      className="space-y-4 rounded-2xl border bg-white p-6"
      aria-label="Restaurar un día del censo"
    >
      <h2 className="text-lg font-bold">Restaurar un día del censo</h2>
      <p>
        Reemplaza el día completo y sus datos por episodio para todos los equipos. Revise camas,
        movimientos, CUDYR y horas oficiales antes de confirmar. Las correcciones posteriores pueden
        perder vigencia.
      </p>
      <p>
        Coordine con los demás equipos y revise sus guardados pendientes. No cierre ni borre sus
        colas.
      </p>
      <form
        className="flex flex-wrap items-end gap-4"
        onSubmit={event => {
          event.preventDefault();
          try {
            const [day, time] = moment.split('T');
            if (backupId) {
              void preview({ date, backupId });
            } else {
              const instant = clinicalWallClockToDate(day, time);
              const shown = calendarStampInClinicalTimeZone(instant);
              if (shown.iso !== day || shown.hhmm !== time)
                throw new Error('invalid hospital time');
              void preview({ date, readTime: instant.toISOString() });
            }
          } catch {
            setState({ kind: 'failed', message: 'El momento indicado no es válido en Rapa Nui.' });
          }
        }}
      >
        <label>
          Fecha del censo
          <input
            className="block rounded border p-2"
            type="date"
            required
            value={date}
            disabled={busy}
            onChange={event => {
              setDate(event.target.value);
              setState({ kind: 'idle' });
            }}
          />
        </label>
        <label>
          Momento a recuperar (hora de Rapa Nui)
          <input
            className="block rounded border p-2"
            type="datetime-local"
            required={!backupId}
            step="60"
            value={moment}
            disabled={busy}
            onChange={event => {
              setMoment(event.target.value);
              setState({ kind: 'idle' });
            }}
          />
        </label>
        <label>
          Copia previa para deshacer (opcional)
          <input
            className="block rounded border p-2"
            value={backupId}
            disabled={busy}
            onChange={event => {
              setBackupId(event.target.value.trim());
              setState({ kind: 'idle' });
            }}
          />
        </label>
        <button
          className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
          disabled={busy}
        >
          Consultar comparación
        </button>
      </form>
      {busy && (
        <p role="status">
          {state.kind === 'loading'
            ? 'Leyendo el respaldo…'
            : 'Restaurando y guardando copia previa…'}
        </p>
      )}
      {state.kind === 'failed' && <p role="alert">{state.message}</p>}
      {state.kind === 'preview' && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Comparison title="Estado actual" value={state.value.current} />
            <Comparison title="Estado que se restaurará" value={state.value.selected} />
          </div>
          <p>
            Se guardará una copia previa durante 48 horas. Esta decisión también reemplaza cierres,
            CUDYR saneado y horas oficiales presentes en el documento.
          </p>
          <label>
            Escriba {state.source.date} para confirmar
            <input
              className="ml-2 rounded border p-2"
              value={confirmation}
              onChange={event => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            className="ml-3 rounded bg-red-800 px-4 py-2 text-white disabled:opacity-50"
            disabled={confirmation !== state.source.date}
            onClick={() => void restore()}
          >
            Restaurar el día completo
          </button>
        </>
      )}
      {state.kind === 'restored' && (
        <div role="status">
          <p>
            Restauración confirmada. Nueva versión {state.value.revision}. Compruebe el censo desde
            otro equipo y revise la auditoría.
          </p>
          <p>
            Copia previa: {state.value.backupId}. Disponible hasta{' '}
            {stamp(state.value.backupExpiresAt)}.
          </p>
          <button
            className="rounded border p-2"
            onClick={() => void preview({ date: state.value.date, backupId: state.value.backupId })}
          >
            Comparar para deshacer esta restauración
          </button>
        </div>
      )}
    </section>
  );
};
