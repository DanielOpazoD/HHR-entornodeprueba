import { cudyrMomentLabel } from '@/services/cudyr/cudyrReportPresentation';
import { useEffect, useRef, useState } from 'react';
import { loadCudyrReviews } from '@/services/cudyr/cudyrReviewService';
import { CUDYR_LINK_LABELS } from '@/services/cudyr/cudyrLinkReview';
import type { SavedCudyrReview } from '@/types/domain/cudyrReview';

export const CudyrReviewHistory = ({ review }: { review: SavedCudyrReview }) => {
  const [records, setRecords] = useState<SavedCudyrReview[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const load = async () => {
    active.current?.abort();
    const request = new AbortController();
    active.current = request;
    setBusy(true);
    setError('');
    try {
      const result = await loadCudyrReviews(review.month, request.signal, review.id);
      if (!request.signal.aborted) setRecords(result.sort((a, b) => b.revision - a.revision));
    } catch {
      if (!request.signal.aborted)
        setError('No se pudo leer el historial completo. Intente de nuevo.');
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  };
  return (
    <details className="mt-2">
      <summary className="cursor-pointer underline">Historial de revisiones</summary>
      <button type="button" className="my-2 underline" disabled={busy} onClick={() => void load()}>
        {busy ? 'Leyendo historial…' : 'Consultar versiones guardadas'}
      </button>
      {error && <p role="alert">{error}</p>}
      {!error &&
        records.map(record => (
          <div key={record.revision} className="my-2 rounded border p-2">
            <p>
              Versión {record.revision} · {record.reviewedBy.name} ·{' '}
              {cudyrMomentLabel(record.updatedAt)} (hora de Rapa Nui)
            </p>
            <p>
              {CUDYR_LINK_LABELS[record.decision.action]} · {record.decision.reason}
            </p>
            <p>
              {record.evidence.patientName} · {record.evidence.sourceDate} · Episodio:{' '}
              {record.decision.episodeId || 'Ninguno'}
            </p>
            {record.evidence.sources.map(source => (
              <p key={source.kind} className="break-all">
                {source.name} · SHA-256 {source.sha256}
              </p>
            ))}
          </div>
        ))}
    </details>
  );
};
