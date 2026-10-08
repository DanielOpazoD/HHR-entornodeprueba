import { useEffect, useRef, useState } from 'react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import { CUDYR_EXCLUSION_LABELS, type CudyrExclusionReason } from '@/types/domain/cudyrExclusion';
import { saveCudyrExclusion } from '@/services/cudyr/cudyrExclusionService';
import { cudyrControlStatus, cudyrEligibilityOrigin } from '@/services/cudyr/cudyrDailyControl';
import { cudyrMomentLabel } from '@/services/cudyr/cudyrReportPresentation';

export const CudyrExclusionDialog = ({
  row,
  canEdit,
  onClose,
  onSaved,
}: {
  row: CudyrReportRow;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [reason, setReason] = useState<CudyrExclusionReason | ''>(row.exclusion?.reason || '');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ signature: string; id: string } | null>(null);
  const controller = useRef(new AbortController());
  const locked = useRef(false);
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (locked.current || !canEdit || !confirmed || !note.trim() || !row.clinicalEpisodeId) return;
    if (!reason && !row.exclusion?.reason) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const payload = {
      date: row.date,
      clinicalEpisodeId: row.clinicalEpisodeId,
      expectedRevision: row.exclusion?.revision || 0,
      reason: reason || null,
      note: note.trim(),
    };
    const signature = JSON.stringify(payload);
    if (request.current?.signature !== signature)
      request.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await saveCudyrExclusion(
        {
          ...payload,
          operationId: request.current.id,
          kind: 'save-daily-exclusion',
          schemaVersion: 1,
          confirmed: true,
        },
        controller.current.signal
      );
      if (
        !result.persisted ||
        result.exclusion.operationId !== request.current.id ||
        result.exclusion.date !== row.date ||
        result.exclusion.clinicalEpisodeId !== row.clinicalEpisodeId
      )
        throw new Error('No se confirmó el guardado remoto. Reintente.');
      onSaved();
    } catch (caught) {
      if (!controller.current.signal.aborted)
        setError(caught instanceof Error ? caught.message : 'No se guardó la exclusión.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return (
    <BaseModal
      isOpen
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Revisar elegibilidad CUDYR"
      closeOnBackdrop={!busy}
      showCloseButton={!busy}
    >
      <form onSubmit={submit} className="space-y-4 text-sm">
        <p className="font-semibold">
          {row.patientName} · {row.date} · {row.bedName || row.bedId}
        </p>
        <div className="rounded-lg bg-slate-50 p-3">
          <p>
            {row.rut} · {row.diagnosis || 'Diagnóstico no informado'}
          </p>
          <p className="mt-2">
            {cudyrControlStatus(row)} · {row.evaluation?.category || 'Sin categoría'}
          </p>
          <p className="text-xs text-slate-500">
            {row.evaluation?.author || 'Autor no informado'} ·{' '}
            {cudyrMomentLabel(row.evaluation?.recordedAt || '')}
            <br />
            Origen: {row.evaluation?.source || 'Sin resultado confirmado'}
            <br />
            Última consulta: {cudyrMomentLabel(row.lastCaptureAt)}
          </p>
          {row.warnings.map(warning => (
            <p key={warning} className="mt-1 text-xs text-amber-800">
              {warning}
            </p>
          ))}
          <p>{row.eligibilityReason}</p>
          <p className="mt-1 text-xs text-slate-500">{cudyrEligibilityOrigin(row)}</p>
          {row.exclusion && (
            <p className="mt-2">
              Última revisión: {row.exclusion.updatedBy.name} ·{' '}
              {cudyrMomentLabel(row.exclusion.updatedAt)}
              <br />
              {row.exclusion.note}
            </p>
          )}
        </div>
        <p>
          La decisión afecta solo este paciente y este día. No elimina el CUDYR ni da de alta al
          paciente.
        </p>
        <fieldset disabled={busy || !canEdit || !row.clinicalEpisodeId} className="space-y-3">
          <label className="block">
            Motivo de exclusión
            <select
              className="mt-1 w-full rounded-lg border p-2"
              value={reason}
              onChange={e => setReason(e.target.value as CudyrExclusionReason | '')}
            >
              <option value="">
                {row.exclusion?.reason
                  ? 'Retirar exclusión manual y recalcular'
                  : 'Seleccione un motivo'}
              </option>
              {Object.entries(CUDYR_EXCLUSION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Observación que respalda la decisión
            <textarea
              required
              maxLength={500}
              rows={3}
              value={note}
              onChange={e => setNote(e.target.value)}
              className="mt-1 w-full rounded-lg border p-2"
            />
          </label>
          <p className="text-xs text-slate-500">
            La falta de epicrisis no demuestra un alta. Si salió del hospital, indique la fecha y la
            evidencia revisada.
          </p>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
            />
            Confirmo la revisión de este día y su efecto en el cumplimiento y el Excel.
          </label>
        </fieldset>
        {!row.clinicalEpisodeId && (
          <p role="alert">Falta un episodio confirmado; actualice el censo antes de revisar.</p>
        )}
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={
            busy ||
            !canEdit ||
            !confirmed ||
            !note.trim() ||
            (!reason && !row.exclusion?.reason) ||
            !row.clinicalEpisodeId
          }
          className="rounded-lg bg-teal-700 px-4 py-2 font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Confirmando en HHR…' : 'Guardar revisión'}
        </button>
      </form>
    </BaseModal>
  );
};
