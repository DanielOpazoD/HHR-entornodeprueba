import React from 'react';
import type { RayenSyncStructuralReviewEvidence } from '@/types/domain/rayenSync';
import {
  presentRayenDeferredHistoricalAdmissionNote,
  presentRayenStructuralReviewDetails,
} from './rayenSyncPresentation';

interface RayenSyncStructuralReviewDetailProps {
  review?: RayenSyncStructuralReviewEvidence;
}

export const RayenSyncStructuralReviewDetail: React.FC<RayenSyncStructuralReviewDetailProps> = ({
  review,
}) => {
  const details = presentRayenStructuralReviewDetails(review);
  const deferredHistoricalAdmissionNote = presentRayenDeferredHistoricalAdmissionNote(review);
  if (details.length === 0 && !deferredHistoricalAdmissionNote) return null;

  return (
    <>
      {details.length > 0 && (
        <div
          data-testid="rayen-structural-review-detail"
          className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900"
        >
          <p className="font-bold">Qué quedó pendiente en el censo</p>
          {review?.structureConfirmed && (
            <p className="mt-1">
              El censo del día quedó confirmado; sólo quedaron fuera los elementos indicados a
              continuación.
            </p>
          )}
          <ul className="mt-1 space-y-1">
            {details.map((detail, index) => (
              <li key={`${detail}-${index}`}>{detail}</li>
            ))}
          </ul>
        </div>
      )}
      {deferredHistoricalAdmissionNote && (
        <div
          data-testid="rayen-historical-admission-note"
          className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-700"
        >
          <p className="font-bold text-slate-800">Comprobación del turno anterior</p>
          <p className="mt-1">{deferredHistoricalAdmissionNote}</p>
        </div>
      )}
    </>
  );
};
