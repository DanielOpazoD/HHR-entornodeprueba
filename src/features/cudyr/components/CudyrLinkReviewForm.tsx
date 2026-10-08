import { useState } from 'react';
import {
  CUDYR_GROUP_LABELS,
  CUDYR_MODALITY_LABELS,
  CUDYR_ELIGIBILITY_LABELS,
} from '@/services/cudyr/cudyrReportPresentation';
import type { CudyrComparisonItem } from '@/types/domain/cudyrReconciliation';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';
import {
  CUDYR_LINK_LABELS,
  cudyrLinkCandidates,
  validateCudyrLinkDraft,
  type CudyrLinkDraft,
} from '@/services/cudyr/cudyrLinkReview';

export const CudyrLinkReviewForm = ({
  item,
  rows,
  draft,
  onChange,
  onView,
  onSave,
  saveDisabled = false,
  saving = false,
  initialDecision,
  savedDecision,
}: {
  item: CudyrComparisonItem;
  rows: CudyrReportRow[];
  draft?: CudyrLinkDraft;
  onChange: (draft?: CudyrLinkDraft) => void;
  onView: (key: string) => void;
  onSave?: (draft: CudyrLinkDraft) => void;
  saveDisabled?: boolean;
  saving?: boolean;
  initialDecision?: CudyrLinkDraft;
  savedDecision?: CudyrLinkDraft;
}) => {
  const [action, setAction] = useState<CudyrLinkDraft['action']>(
    draft?.action || initialDecision?.action || 'pending'
  );
  const [episodeId, setEpisodeId] = useState(draft?.episodeId || initialDecision?.episodeId || '');
  const [reason, setReason] = useState(draft?.reason || initialDecision?.reason || '');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const candidates = cudyrLinkCandidates(item, rows);
  const selected = candidates.find(c => c.episodeId === episodeId);
  return (
    <details className="mt-3 rounded border border-teal-200 bg-white p-3">
      <summary className="cursor-pointer font-medium text-teal-900">
        {onSave
          ? initialDecision
            ? 'Editar revisión'
            : 'Revisar y guardar'
          : draft
            ? `${CUDYR_LINK_LABELS[draft.action]} · borrador`
            : 'Revisar vínculo · borrador'}
      </summary>
      <p className="my-2 text-xs text-slate-600">
        {onSave
          ? 'Guardar conserva la decisión, su revisor y fecha en HHR.'
          : 'Esta decisión queda solo en esta consulta.'}{' '}
        No confirma una aplicación CUDYR ni cambia autoría, fecha, categoría, elegibilidad o alta.
        No se incluye en el Excel.
      </p>
      {draft && (
        <p role="status" className="my-2 break-words text-xs">
          Decisión anotada: {draft.reason}
          {draft.episodeId ? ` · Episodio ${draft.episodeId}` : ''}
        </p>
      )}
      <label className="block my-2">
        Decisión de revisión
        <select
          className="mt-1 block w-full rounded border p-2"
          value={action}
          onChange={e => {
            setAction(e.target.value as CudyrLinkDraft['action']);
            setAcknowledged(false);
          }}
        >
          <option value="pending">Dejar pendiente con observación</option>
          <option value="link">Proponer vínculo a un episodio</option>
          <option value="exclude">Descartar esta fila del cotejo</option>
        </select>
      </label>
      {action === 'link' && (
        <>
          <label className="block my-2">
            Episodio HHR a revisar
            <select
              className="mt-1 block w-full rounded border p-2"
              value={episodeId}
              onChange={e => {
                setEpisodeId(e.target.value);
                setAcknowledged(false);
              }}
            >
              <option value="">Seleccionar explícitamente</option>
              {candidates.map(c => (
                <option key={c.episodeId} value={c.episodeId}>
                  {c.rows[0].patientName} · {c.episodeId} · censos {c.rows[0].date} a{' '}
                  {c.rows[c.rows.length - 1].date}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-amber-900">
            El documento puede ser compartido por un RN u otra persona. Se muestran los episodios de
            ese documento presentes en esta lectura; no es un historial completo.
          </p>
          {!candidates.length && (
            <p role="status" className="my-2 text-amber-900">
              No hay episodios identificados y consistentes para proponer un vínculo. Deje la fila
              pendiente y amplíe la evidencia.
            </p>
          )}
          {selected && (
            <ul className="my-2 max-h-48 space-y-2 overflow-auto rounded bg-slate-50 p-2 text-xs">
              {selected.rows.map(r => (
                <li key={r.key} className="break-words">
                  {r.date} · {r.bedId || 'Sin cama'} · {CUDYR_GROUP_LABELS[r.group]} ·{' '}
                  {CUDYR_MODALITY_LABELS[r.modality]} · {CUDYR_ELIGIBILITY_LABELS[r.eligibility]} ·
                  Ingreso {r.admissionDate || 'no informado'} · {r.diagnosis || 'Sin diagnóstico'}{' '}
                  <button type="button" className="underline" onClick={() => onView(r.key)}>
                    Ver contexto del {r.date}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="my-3 flex items-start gap-2">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={e => setAcknowledged(e.target.checked)}
            />
            <span>
              Revisé identidad, episodio y fechas con evidencia adicional; el RUT o la categoría por
              sí solos no bastan.
            </span>
          </label>
        </>
      )}
      <label className="block my-2">
        Motivo y respaldo de la revisión
        <textarea
          className="mt-1 block w-full rounded border p-2"
          maxLength={1000}
          rows={3}
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="my-2 text-red-800">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={Boolean(
            onSave &&
            (saveDisabled ||
              (savedDecision &&
                savedDecision.action === action &&
                savedDecision.episodeId === (action === 'link' ? episodeId : '') &&
                savedDecision.reason === reason.trim()))
          )}
          className="rounded bg-teal-800 px-3 py-2 text-white disabled:opacity-50"
          onClick={() => {
            const next = {
              action,
              episodeId: action === 'link' ? episodeId : '',
              reason: reason.trim(),
            };
            const issue = validateCudyrLinkDraft(item, rows, next, acknowledged);
            setError(issue);
            if (!issue) {
              onChange(next);
              onSave?.(next);
            }
          }}
        >
          {onSave
            ? saving
              ? 'Guardando revisión…'
              : 'Guardar revisión en HHR'
            : 'Anotar decisión en borrador'}
        </button>
        {draft && (
          <button
            type="button"
            className="underline"
            onClick={() => {
              onChange();
              setEpisodeId('');
              setAction('pending');
              setReason('');
              setAcknowledged(false);
              setError('');
            }}
          >
            Retirar decisión
          </button>
        )}
      </div>
    </details>
  );
};
