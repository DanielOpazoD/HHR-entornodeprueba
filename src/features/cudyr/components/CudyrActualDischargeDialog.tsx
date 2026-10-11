import { useRef, useState } from 'react';
import { BaseModal } from '@/components/shared/BaseModal';
import { CLINICAL_TIME_ZONE, getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { correctCudyrDischarge } from '@/services/cudyr/cudyrDischargeService';
import type {
  CorrectCudyrDischargeRequest,
  CudyrDischargeCorrection,
} from '@/types/domain/cudyrDischarge';

interface Props {
  clinicalEpisodeId: string;
  authorityDate: string;
  patientName: string;
  admissionDate: string;
  sourceDischargeLabel: string;
  correction?: CudyrDischargeCorrection;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (correction: CudyrDischargeCorrection) => void;
}

/** Mount for one episode/revision. The source egreso remains read-only. */
export const CudyrActualDischargeDialog = ({
  clinicalEpisodeId,
  authorityDate,
  patientName,
  admissionDate,
  sourceDischargeLabel,
  correction,
  canEdit,
  onClose,
  onSaved,
}: Props) => {
  const [date, setDate] = useState(correction?.actualDischarge?.date ?? '');
  const [time, setTime] = useState(correction?.actualDischarge?.time ?? '');
  const [clearDate, setClearDate] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const initial = useRef({ clinicalEpisodeId, revision: correction?.revision ?? 0 });
  const attempt = useRef<{ signature: string; operationId: string } | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const stale =
    initial.current.clinicalEpisodeId !== clinicalEpisodeId ||
    initial.current.revision !== (correction?.revision ?? 0);
  const close = () => {
    if (!locked.current) onClose();
  };
  const canSave =
    canEdit &&
    !busy &&
    !stale &&
    confirmed &&
    reason.trim() &&
    (clearDate ? Boolean(correction?.actualDischarge) : Boolean(date));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const actualDischarge: CorrectCudyrDischargeRequest['actualDischarge'] = clearDate
      ? null
      : { date, ...(time ? { time } : {}), timeZone: CLINICAL_TIME_ZONE };
    const signature = JSON.stringify({
      clinicalEpisodeId,
      authorityDate,
      actualDischarge,
      reason: reason.trim(),
    });
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, operationId: crypto.randomUUID() };
    const request: CorrectCudyrDischargeRequest = {
      kind: 'correct-discharge',
      schemaVersion: 1,
      operationId: attempt.current.operationId,
      clinicalEpisodeId,
      authorityDate,
      expectedRevision: initial.current.revision,
      actualDischarge,
      reason: reason.trim(),
      confirmed: true,
    };
    try {
      const response = await correctCudyrDischarge(request);
      if (
        !response.success ||
        !response.persisted ||
        response.correction?.clinicalEpisodeId !== clinicalEpisodeId ||
        response.correction.operationId !== request.operationId
      )
        throw new Error('No se confirmó el guardado. Reintente sin cambiar los datos.');
      onSaved(response.correction);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'No se confirmó la corrección del alta real.'
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return (
    <BaseModal
      isOpen
      onClose={close}
      title="Verificar alta real"
      initialFocusRef={dateRef}
      closeOnBackdrop={!busy}
      showCloseButton={!busy}
      dataTestId="cudyr-actual-discharge-dialog"
    >
      <form onSubmit={submit} className="space-y-4 text-sm">
        <p className="font-semibold text-slate-900">{patientName}</p>
        <dl className="rounded-lg bg-slate-50 p-3 text-slate-700">
          <dt className="font-medium">Egreso informado por el sistema</dt>
          <dd className="mt-1">{sourceDischargeLabel || 'No informado'}</dd>
        </dl>
        <p className="text-slate-600">
          Registre la salida física verificada. La epicrisis y el egreso del sistema se conservan
          por separado. Horario de Rapa Nui.
        </p>
        {correction?.actualDischarge && (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={clearDate}
              onChange={event => setClearDate(event.target.checked)}
              disabled={busy}
            />
            Retirar la fecha verificada y dejar el alta real pendiente de aclaración
          </label>
        )}
        <fieldset
          disabled={busy || !canEdit || stale || clearDate}
          className="grid grid-cols-2 gap-3"
        >
          <label className="space-y-1">
            Fecha real de alta
            <input
              ref={dateRef}
              type="date"
              value={date}
              required={!clearDate}
              min={admissionDate}
              max={getClinicalCalendarDateISO()}
              onChange={event => setDate(event.target.value)}
              className="block w-full rounded-lg border border-slate-300 p-2"
            />
          </label>
          <label className="space-y-1">
            Hora, si está confirmada
            <input
              type="time"
              value={time}
              onChange={event => setTime(event.target.value)}
              className="block w-full rounded-lg border border-slate-300 p-2"
            />
          </label>
        </fieldset>
        <label className="block space-y-1">
          Motivo y respaldo de la corrección
          <textarea
            required
            maxLength={500}
            rows={3}
            value={reason}
            disabled={busy || !canEdit || stale}
            onChange={event => setReason(event.target.value)}
            className="block w-full rounded-lg border border-slate-300 p-2"
          />
        </label>
        <label className="flex items-start gap-2 text-slate-700">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={busy || !canEdit || stale}
            onChange={event => setConfirmed(event.target.checked)}
          />
          Confirmo esta corrección. Quedará registrada con mi identidad, fecha y motivo.
        </label>
        {stale && (
          <p role="alert" className="text-amber-800">
            El alta cambió mientras estaba abierta. Cierre y vuelva a revisar la versión vigente.
          </p>
        )}
        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={close}
            className="rounded-lg border px-4 py-2"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="rounded-lg bg-teal-700 px-4 py-2 font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Guardando…' : 'Guardar alta real'}
          </button>
        </div>
      </form>
    </BaseModal>
  );
};
