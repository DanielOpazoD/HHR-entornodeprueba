import { RayenSyncCaseDetail } from './RayenSyncCaseDetail';
import { explainRayenStructuralIssue } from '../domain/rayenStructuralIssueExplanation';
import React from 'react';
import type { RayenSyncStructuralReviewEvidence } from '@/types/domain/rayenSync';
import {
  presentRayenDeferredHistoricalAdmissionNote,
  presentRayenStructuralReviewDetails,
} from './rayenSyncPresentation';
import { RayenSyncIssueActions } from './RayenSyncIssueActions';
import { rayenStructuralIssueHasCurrentBed, rayenSyncTechnicalCode } from './rayenSyncIssueSupport';

interface RayenSyncStructuralReviewDetailProps {
  review?: RayenSyncStructuralReviewEvidence;
  censusDate?: string | null;
}

export const RayenSyncStructuralReviewDetail: React.FC<RayenSyncStructuralReviewDetailProps> = ({
  review,
  censusDate,
}) => {
  const details = presentRayenStructuralReviewDetails(review);
  const deferredHistoricalAdmissionNote = presentRayenDeferredHistoricalAdmissionNote(review);
  if (details.length === 0 && !deferredHistoricalAdmissionNote) return null;

  return (
    <>
      {details.length > 0 && (
        <details
          data-testid="rayen-structural-review-detail"
          className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-sm leading-relaxed text-amber-900"
        >
          <summary className="cursor-pointer font-bold">Qué quedó pendiente en el censo</summary>
          {review?.structureConfirmed && (
            <p className="mt-1">
              El censo del día quedó confirmado; sólo quedaron fuera los elementos indicados a
              continuación.
            </p>
          )}
          <ul className="mt-1 space-y-1">
            {details.map((detail, index) => (
              <li key={`${detail}-${index}`} className="py-1">
                {review?.issues?.[index] ? (
                  <>
                    <p className="font-bold">
                      {explainRayenStructuralIssue(review.issues[index].reason).title}
                    </p>
                    <RayenSyncCaseDetail
                      diagnostic={review.issues[index].diagnostic}
                      caseContext={review.issues[index].caseContext}
                      bedId={review.issues[index].bedId}
                    />
                    <p>{explainRayenStructuralIssue(review.issues[index].reason).meaning}</p>
                    <p className="mt-1">Este cambio no se aplicó automáticamente.</p>
                    <p className="mt-1">
                      <strong>Qué hacer:</strong>{' '}
                      {explainRayenStructuralIssue(review.issues[index].reason).action}
                    </p>
                  </>
                ) : (
                  <p>{detail}</p>
                )}
                {review?.issues?.[index] && (
                  <RayenSyncIssueActions
                    code={rayenSyncTechnicalCode('census', review.issues[index].reason)}
                    date={
                      review.issues[index].caseContext?.censusDate ??
                      (rayenStructuralIssueHasCurrentBed(review.issues[index].reason)
                        ? censusDate
                        : null)
                    }
                    bedId={review.issues[index].caseContext?.bedId ?? review.issues[index].bedId}
                  />
                )}
              </li>
            ))}
          </ul>
        </details>
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
