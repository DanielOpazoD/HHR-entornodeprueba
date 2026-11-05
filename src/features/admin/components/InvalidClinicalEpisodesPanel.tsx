import React, { useCallback, useEffect, useState } from 'react';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';
import {
  listInvalidClinicalEpisodes,
  removeInvalidClinicalEpisodeMark,
  type InvalidClinicalEpisodeRecord,
} from '@/services/census/invalidClinicalEpisodeService';

type State =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; marks: InvalidClinicalEpisodeRecord[] };

const stamp = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('es-CL', {
        timeZone: CLINICAL_TIME_ZONE,
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(value))
    : 'pendiente';

/** Admin review of the episodes marked «paciente no válido», with undo. */
export const InvalidClinicalEpisodesPanel: React.FC = () => {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeFailed, setRemoveFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setState({ kind: 'ready', marks: await listInvalidClinicalEpisodes() });
    } catch {
      setState({ kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (clinicalEpisodeId: string) => {
    setRemoving(clinicalEpisodeId);
    setRemoveFailed(false);
    try {
      await removeInvalidClinicalEpisodeMark(clinicalEpisodeId);
      await load();
    } catch {
      setRemoveFailed(true);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section className="mt-3 rounded border bg-white p-3 text-sm">
      <h2 className="font-bold">Pacientes marcados como no válidos</h2>
      <p className="mb-2 text-slate-600">
        Al quitar una marca, la próxima sincronización con Eloísa vuelve a traer al paciente si el
        episodio sigue abierto, o registra su egreso si ya se cerró.
      </p>
      {state.kind === 'loading' && <p role="status">Cargando…</p>}
      {state.kind === 'failed' && (
        <p role="alert">
          No se pudo leer la lista.{' '}
          <button type="button" className="underline" onClick={() => void load()}>
            Reintentar
          </button>
        </p>
      )}
      {state.kind === 'ready' && state.marks.length === 0 && <p>No hay pacientes marcados.</p>}
      {state.kind === 'ready' && state.marks.length > 0 && (
        <table className="w-full text-left">
          <thead>
            <tr>
              <th>Episodio</th>
              <th>Día del censo</th>
              <th>Cama</th>
              <th>Marcado</th>
              <th>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {state.marks.map(mark => (
              <tr key={mark.clinicalEpisodeId}>
                <td className="tabular-nums">{mark.clinicalEpisodeId}</td>
                <td className="tabular-nums">{mark.censusDate}</td>
                <td>{mark.bedId}</td>
                <td className="tabular-nums">{stamp(mark.markedAt)}</td>
                <td>
                  <button
                    type="button"
                    className="rounded border px-2 py-1"
                    disabled={removing !== null}
                    onClick={() => void remove(mark.clinicalEpisodeId)}
                  >
                    {removing === mark.clinicalEpisodeId ? 'Quitando…' : 'Quitar marca'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {removeFailed && <p role="alert">No se pudo quitar la marca. Revisa la conexión.</p>}
    </section>
  );
};
