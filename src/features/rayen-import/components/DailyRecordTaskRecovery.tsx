import React from 'react';
import {
  getDailyRecordReviewBackup,
  retireReviewedDailyRecordTask,
  reviewBlockedDailyRecordTask,
  type DailyRecordTaskReview,
} from '@/services/storage/sync/dailyRecordTaskRetirement';
import { downloadBlob } from '@/services/exporters/exportDownload';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { targetLabelFromKey } from './localSyncPresentation';
import { SYNC_TONE } from './syncTone';
import {
  classifyConflictChangedContexts,
  type ConflictDomainContext,
} from '@/services/repositories/conflictResolutionDomainPolicy';

const SCOPE_LABELS: Record<ConflictDomainContext, string> = {
  clinical: 'Datos de pacientes, camas o cunas',
  handoff: 'Notas y novedades de entrega',
  staffing: 'Dotación y turnos',
  movements: 'Altas, traslados o CMA',
  metadata: 'Fechas y datos de control',
  unknown: 'Otros campos del censo',
};

const DeclaredScope: React.FC<{ task: SyncTask }> = ({ task }) => {
  const paths = task.syncContract?.changedPaths;
  const hasFieldDetail =
    Array.isArray(paths) &&
    paths.length > 0 &&
    paths.every(path => typeof path === 'string' && path.trim() && !path.includes('*'));
  const labels = hasFieldDetail
    ? classifyConflictChangedContexts(paths).map(context => SCOPE_LABELS[context])
    : [];
  return (
    <div>
      <p className="font-medium">Contenido del envío</p>
      {labels.length > 0 ? (
        <>
          <p>Cambios indicados por este envío:</p>
          <ul aria-label="Contenido del envío" className="list-disc pl-4">
            {labels.map(label => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          <p>
            Este resumen no compara con el servidor. Descarga la copia para revisar los valores.
          </p>
        </>
      ) : (
        <p>No hay detalle por campo de este envío. Descarga la copia para revisar su contenido.</p>
      )}
    </div>
  );
};

const saveBackup = (content: string | null, id: number) => {
  if (!content) throw new Error('El envío o la sesión cambió.');
  downloadBlob(new Blob([content], { type: 'application/json' }), `hhr-envio-local-${id}.json`);
};

interface Props {
  taskId: number;
  onClose: () => void;
  onRetired: () => Promise<void>;
}

export default function DailyRecordTaskRecovery({ taskId, onClose, onRetired }: Props) {
  const [review, setReview] = React.useState<DailyRecordTaskReview | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let active = true;
    void reviewBlockedDailyRecordTask(taskId)
      .then(value => {
        if (!active) return;
        setReview(value);
        if (!value) setError('El envío cambió o ya no está bloqueado. Revisa el panel de nuevo.');
      })
      .catch(() => {
        if (active) setError('El envío todavía no se leyó y sigue pendiente; vuelve a intentar.');
      });
    return () => {
      active = false;
    };
  }, [taskId]);

  const act = async (discard: boolean) => {
    if (!review) return;
    setBusy(true);
    setError('');
    try {
      if (discard) {
        if (!(await retireReviewedDailyRecordTask(review)))
          throw new Error('El envío o la sesión cambió.');
        await onRetired();
      } else saveBackup(await getDailyRecordReviewBackup(review), taskId);
    } catch {
      setError('La acción no terminó. Revisa el panel de nuevo antes de continuar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-label="Descartar envío del censo" className="mt-2 space-y-2 text-xs">
      {review && (
        <>
          <p className="font-semibold">{targetLabelFromKey(review.task.key, review.task.type)}</p>
          <DeclaredScope task={review.task} />
          <p>
            Este envío se descartará y no se enviará. Lo guardado en el servidor no cambia. Si
            necesitas guardar una copia, descárgala antes de confirmar.
          </p>
          <button type="button" disabled={busy} onClick={() => void act(false)}>
            Descargar copia para revisar
          </button>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={event => setConfirmed(event.target.checked)}
            />
            Ya revisé el censo compartido y no necesito enviar estos cambios.
          </label>
          <button
            type="button"
            disabled={!confirmed || busy}
            onClick={() => void act(true)}
            className={`${SYNC_TONE.action.text} underline disabled:opacity-50`}
          >
            Sí, descartar envío
          </button>{' '}
        </>
      )}
      <button type="button" disabled={busy} onClick={onClose}>
        Cancelar
      </button>
      {error && <p role="status">{error}</p>}
    </div>
  );
}
