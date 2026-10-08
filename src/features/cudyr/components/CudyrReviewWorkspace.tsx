import { CudyrReviewResume } from './CudyrReviewResume';
import { cudyrMomentLabel } from '@/services/cudyr/cudyrReportPresentation';
import type { CudyrComparisonItem } from '@/types/domain/cudyrReconciliation';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import type { CudyrReviewSource } from '@/types/domain/cudyrReview';
import { isCurrentCudyrReview } from '@/services/cudyr/cudyrReviewEvidence';
import { isReviewableCudyrSource } from '@/services/cudyr/cudyrLinkReview';
import { useCudyrReviews } from '../hooks/useCudyrReviews';
import { CudyrComparisonRows } from './CudyrComparisonRows';

export const CudyrReviewWorkspace = ({
  data,
  items,
  sources,
  canReview,
  canRead = true,
  onView,
  onResume,
}: {
  data: CudyrReportDataset;
  items: CudyrComparisonItem[];
  sources: CudyrReviewSource[];
  canReview: boolean;
  canRead?: boolean;
  onView: (key: string) => void;
  onResume?: (sources: CudyrReviewSource[]) => void;
}) => {
  const review = useCudyrReviews(data, items, sources, canReview, canRead);
  const current = review.records.filter(r => isCurrentCudyrReview(r, review.evidence[r.entryKey]));
  const resolved = current.filter(r => r.decision.action !== 'pending').length;
  const stale = review.records.filter(r => !isCurrentCudyrReview(r, review.evidence[r.entryKey]));
  const outside = stale.filter(r => !items.some(item => item.key === r.entryKey));
  return (
    <div className="space-y-3">
      {canRead && (
        <section aria-label="Revisión mensual guardada" className="rounded bg-teal-50 p-3 text-xs">
          <p>
            Las decisiones guardadas se pueden retomar. Conservan revisor y fecha; no cambian CUDYR,
            altas, totales ni Excel.
          </p>
          {review.busy && <p role="status">Procesando revisión…</p>}
          {review.ready && (
            <p role="status" className="mt-2 font-semibold">
              {Math.max(
                0,
                items.filter(isReviewableCudyrSource).length -
                  resolved -
                  (stale.length - outside.length)
              )}{' '}
              pendientes · {resolved} revisados · {stale.length} requieren revisión
            </p>
          )}
          {review.error && (
            <p role="alert" className="my-2 text-red-800">
              {review.error}
            </p>
          )}
          <button
            type="button"
            disabled={review.busy}
            className="mt-2 underline"
            onClick={review.refresh}
          >
            Recargar revisiones guardadas
          </button>
          {review.ready && !sources.length && onResume && (
            <CudyrReviewResume
              records={review.records}
              from={data.from}
              to={data.to}
              onResume={onResume}
            />
          )}
          {outside.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer">
                {outside.length} decisiones guardadas fuera de las filas actuales
              </summary>
              <p>
                Seleccione los archivos y el período originales para retomarlas. No se trasladan a
                otras filas.
              </p>
              {outside.map(r => (
                <p key={r.id} className="my-2">
                  {r.evidence.patientName} · {r.evidence.sourceDate} · {r.decision.reason} · Revisor{' '}
                  {r.reviewedBy.name} · {cudyrMomentLabel(r.updatedAt)} (hora de Rapa Nui) ·{' '}
                  {r.evidence.sources.map(s => s.name).join(', ')}
                </p>
              ))}
            </details>
          )}
        </section>
      )}
      {sources.length ? (
        <CudyrComparisonRows
          data={data}
          items={items}
          onView={onView}
          canReview={canReview}
          review={canRead ? review : undefined}
        />
      ) : (
        <p>
          Seleccione el informe original para cotejar y retomar sus decisiones. No se consultará
          Eloísa.
        </p>
      )}
    </div>
  );
};
