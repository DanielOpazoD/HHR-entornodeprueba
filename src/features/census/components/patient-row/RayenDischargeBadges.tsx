import React from 'react';
import { ClipboardCheck, FileCheck2 } from 'lucide-react';
import { formatDateTimeCL } from '@/utils/dateDisplayUtils';

/** Tooltip shared by the medical badge and its tests. */
export const MEDICAL_DISCHARGE_DESCRIPTION =
  'Alta médica registrada en Eloísa · egreso pendiente en Gestión de Camas';

/** Tooltip shared by the nursing badge and its tests. */
export const NURSING_DISCHARGE_DESCRIPTION =
  'Alta de enfermería registrada en Eloísa · egreso pendiente en Gestión de Camas';

export interface RayenDischargeVerification {
  medicalEpicrisis: 'confirmed' | 'not-detected' | 'unknown';
  nursingEpicrisis: 'confirmed' | 'not-detected' | 'unknown';
  registeredAt?: string;
}

const badgeClassName =
  'inline-flex items-center rounded px-1 py-px leading-none ring-1 ring-white shadow-sm';

/**
 * Marks the clinical closures Eloísa already registered while the bed is still occupied. When both
 * the medical and the nursing discharge exist the badges overlap like stacked cards, so the census
 * shows at a glance that only the administrative egreso in Gestión de Camas is missing.
 */
export const RayenDischargeBadges: React.FC<{
  verification?: RayenDischargeVerification;
}> = ({ verification }) => {
  const hasMedicalDischarge = verification?.medicalEpicrisis === 'confirmed';
  const hasNursingDischarge = verification?.nursingEpicrisis === 'confirmed';
  if (!hasMedicalDischarge && !hasNursingDischarge) return null;

  const medicalDescription = verification?.registeredAt
    ? `${MEDICAL_DISCHARGE_DESCRIPTION} · alta registrada ${formatDateTimeCL(verification.registeredAt)}`
    : MEDICAL_DISCHARGE_DESCRIPTION;

  return (
    <span className="inline-flex items-center" data-testid="rayen-discharge-badges">
      {hasNursingDischarge && (
        <span
          role="img"
          className={`${badgeClassName} ${hasMedicalDischarge ? 'z-0' : ''} bg-sky-100 text-sky-700`}
          title={NURSING_DISCHARGE_DESCRIPTION}
          aria-label={NURSING_DISCHARGE_DESCRIPTION}
        >
          <ClipboardCheck size={10} strokeWidth={2.5} aria-hidden="true" />
        </span>
      )}
      {hasMedicalDischarge && (
        <span
          role="img"
          className={`${badgeClassName} ${
            hasNursingDischarge ? '-ml-1 z-10' : ''
          } bg-emerald-100 text-emerald-700`}
          title={medicalDescription}
          aria-label={medicalDescription}
        >
          <FileCheck2 size={10} strokeWidth={2.5} aria-hidden="true" />
        </span>
      )}
    </span>
  );
};
