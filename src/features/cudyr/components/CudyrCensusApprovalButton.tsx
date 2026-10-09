import { useEffect, useRef, useState } from 'react';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import { prepareCudyrCensusApproval } from '@/services/cudyr/cudyrCensusApproval';
import {
  approveCudyrReconstructedCensus,
  loadCudyrVerifiedContexts,
} from '@/services/cudyr/cudyrVerifiedContextService';

export const CudyrCensusApprovalButton = ({
  data,
  onApproved,
}: {
  data: CudyrReportDataset;
  onApproved: () => void;
}) => {
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState(
    'Censo reconstruido y conciliado con los registros HHR y la evidencia de Eloísa. Se aprueba como población oficial del informe CUDYR.'
  );
  const approve = async () => {
    const controller = new AbortController();
    active.current?.abort();
    active.current = controller;
    const owner = getStoredSessionOwnerKey();
    const generation = getSessionGeneration();
    const check = () => {
      controller.signal.throwIfAborted();
      if (owner !== getStoredSessionOwnerKey() || generation !== getSessionGeneration())
        throw new Error('La sesión cambió. Vuelva a abrir el mes.');
    };
    setBusy(true);
    setError('');
    try {
      const days = await prepareCudyrCensusApproval(data);
      check();
      const reviews = await loadCudyrVerifiedContexts(data.from, data.to, controller.signal);
      check();
      const review = reviews.find(r => r.month === data.from.slice(0, 7));
      if (!review) throw new Error('Falta guardar la conciliación documental del mes.');
      await approveCudyrReconstructedCensus({
        month: review.month,
        expectedRevision: review.revision,
        operationId: crypto.randomUUID(),
        reason,
        days,
      });
      check();
      onApproved();
      setOpen(false);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar el cierre.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  if (!open)
    return (
      <button type="button" className="text-teal-800 underline" onClick={() => setOpen(true)}>
        Aprobar censo reconstruido
      </button>
    );
  return (
    <div className="space-y-2 rounded border border-teal-100 bg-teal-50 p-3">
      <p>
        Se aprueba la población reconstruida de {data.from.slice(0, 7)} para el informe CUDYR. Se
        conserva el cotejo original como respaldo.
      </p>
      <label className="block">
        Motivo del cierre
        <textarea
          className="mt-1 block w-full rounded border bg-white p-2"
          value={reason}
          onChange={e => setReason(e.target.value)}
          disabled={busy}
          maxLength={1800}
        />
      </label>
      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy || reason.trim().length < 20}
          onClick={() => void approve()}
          className="rounded bg-teal-700 px-3 py-1 text-white disabled:opacity-40"
        >
          {busy ? 'Guardando…' : 'Confirmar cierre oficial'}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
    </div>
  );
};
