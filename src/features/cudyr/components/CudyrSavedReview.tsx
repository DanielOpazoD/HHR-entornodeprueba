import { cudyrMomentLabel } from '@/services/cudyr/cudyrReportPresentation';
import { useEffect } from 'react';
import { CudyrReviewHistory } from './CudyrReviewHistory';
import type { CudyrReviewController } from '../hooks/useCudyrReviews';
import type { CudyrLinkDraft } from '@/services/cudyr/cudyrLinkReview';
import { CUDYR_LINK_LABELS } from '@/services/cudyr/cudyrLinkReview';
import { isCurrentCudyrReview } from '@/services/cudyr/cudyrReviewEvidence';

export const CudyrSavedReview = ({
  review,
  entryKey,
  draft,
  onSaved,
  inlineSave = false,
}: {
  review: CudyrReviewController;
  entryKey: string;
  draft?: CudyrLinkDraft;
  onSaved: () => void;
  inlineSave?: boolean;
}) => {
  const saved = review.records.find(r => r.entryKey === entryKey);
  const current = saved && isCurrentCudyrReview(saved, review.evidence[entryKey]);
  useEffect(() => {
    // A lost response may still have committed. Reconcile the retained draft after readback.
    if (
      review.ready &&
      current &&
      draft &&
      JSON.stringify(saved.decision) === JSON.stringify(draft)
    )
      onSaved();
  }, [review.ready, current, saved, draft, onSaved]);
  return (
    <div className="mt-2 rounded border border-teal-200 bg-white p-3 text-xs">
      {saved && (
        <>
          <p className={current ? 'font-semibold text-teal-900' : 'font-semibold text-amber-900'}>
            {current ? 'Revisión guardada' : 'Requiere nueva revisión · cambió la evidencia'} ·
            versión {saved.revision}
          </p>
          <p>
            {CUDYR_LINK_LABELS[saved.decision.action]} · {saved.decision.reason}
          </p>
          <p>
            Revisor: {saved.reviewedBy.name} · {cudyrMomentLabel(saved.updatedAt)} (hora de Rapa
            Nui). No es el autor clínico del CUDYR.
          </p>
          <details className="mt-1">
            <summary className="cursor-pointer underline">Evidencia de esta decisión</summary>
            <p>
              {saved.evidence.patientName} · {saved.evidence.document} · {saved.evidence.sourceDate}{' '}
              · {saved.evidence.sourceValue}
            </p>
            <p>Episodio propuesto: {saved.decision.episodeId || 'Ninguno'}</p>
            <p>
              Período revisado: {saved.evidence.from} a {saved.evidence.to}
            </p>
            {saved.evidence.sources.map(source => (
              <p key={source.kind} className="break-all">
                {source.name} · SHA-256 {source.sha256}
              </p>
            ))}
          </details>
          <CudyrReviewHistory key={`${saved.id}:${saved.revision}`} review={saved} />
        </>
      )}
      {draft && !inlineSave && (
        <button
          type="button"
          disabled={!review.ready || review.busy}
          className="mt-2 rounded bg-teal-800 px-3 py-2 text-white disabled:opacity-50"
          onClick={() =>
            void review.save(entryKey, draft).then(saved => {
              if (saved) onSaved();
            })
          }
        >
          Guardar revisión en HHR
        </button>
      )}
      {!saved && !draft && <p>Sin revisión guardada.</p>}
    </div>
  );
};
