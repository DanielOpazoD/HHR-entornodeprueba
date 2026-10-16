import React from 'react';
import type { RayenSyncStaffingObservation } from '@/types/domain/rayenSync';
import { StaffingBoundaryExclusions } from './StaffingBoundaryExclusions';

const STAFFING_SECTION_LABELS = {
  nurse_day: 'Enfermería · turno día',
  nurse_night: 'Enfermería · turno noche',
  tens_day: 'TENS · turno largo',
  tens_night: 'TENS · turno noche',
} as const;

export const RayenStaffingActivity: React.FC<{ observation?: RayenSyncStaffingObservation }> = ({
  observation,
}) => {
  const staffingNeedsReview = Boolean(observation?.ambiguousSections.length);
  if (!observation) return null;
  return (
    <section aria-label="Enfermería y TENS" className="mt-3 border-t border-slate-100 pt-3">
      {observation && (
        <details
          data-testid="rayen-staffing-observation"
          className="mt-1 rounded-md text-xs text-slate-600"
        >
          <summary className="cursor-pointer rounded-md py-1.5 font-semibold hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600">
            <span className={staffingNeedsReview ? 'text-amber-700' : 'text-slate-600'}>
              {staffingNeedsReview ? 'Requiere revisión' : 'Actividad de relevo'}
            </span>
            <span className="ml-2 font-normal text-slate-500">
              Ver detalle · {observation.ignoredBoundaryRecords} registros
            </span>
          </summary>
          {staffingNeedsReview && (
            <p className="mt-1">
              Pendiente de revisión:{' '}
              {observation.ambiguousSections
                .map(section => STAFFING_SECTION_LABELS[section])
                .join(', ')}
              .
            </p>
          )}
          {observation.ignoredBoundaryRecords > 0 && (
            <StaffingBoundaryExclusions
              total={observation.ignoredBoundaryRecords}
              evidence={observation.ignoredBoundaryEvidence ?? []}
              embedded
            />
          )}
        </details>
      )}
    </section>
  );
};
