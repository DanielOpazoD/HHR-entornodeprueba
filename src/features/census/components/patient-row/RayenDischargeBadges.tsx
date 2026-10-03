import React from 'react';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { formatDateTimeCL } from '@/utils/dateDisplayUtils';
import { usePatientHospitalizationReports } from '@/features/census/components/usePatientHospitalizationReports';

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
  'inline-flex min-h-6 min-w-6 items-center justify-center rounded px-1 py-px leading-none ring-1 ring-white shadow-sm';

interface DischargeBadgeProps {
  verification?: RayenDischargeVerification;
  patientName: string;
  patientRun: string;
  clinicalEpisodeId?: string;
  admissionDate?: string;
  censusDate?: string;
}

export const RayenDischargeBadges: React.FC<DischargeBadgeProps> = props => {
  if (
    props.verification?.medicalEpicrisis !== 'confirmed' &&
    props.verification?.nursingEpicrisis !== 'confirmed'
  )
    return null;
  return (
    <DischargeReportButtons
      key={JSON.stringify([props.clinicalEpisodeId, props.patientRun, props.censusDate])}
      {...props}
    />
  );
};

const DischargeReportButtons: React.FC<DischargeBadgeProps> = props => {
  const { verification, clinicalEpisodeId, admissionDate } = props;
  const { download, downloadingKey } = usePatientHospitalizationReports();
  const episode = { encId: clinicalEpisodeId || '', startDate: admissionDate || '' };
  const medicalDescription = verification?.registeredAt
    ? `${MEDICAL_DISCHARGE_DESCRIPTION} · alta registrada ${formatDateTimeCL(verification.registeredAt)}`
    : MEDICAL_DISCHARGE_DESCRIPTION;
  const badges = [
    {
      type: 'epicrisis' as const,
      state: verification?.medicalEpicrisis,
      description: medicalDescription,
      label: 'Descargar epicrisis médica',
      color: 'bg-emerald-100 text-emerald-700',
    },
    {
      type: 'nursing-epicrisis' as const,
      state: verification?.nursingEpicrisis,
      description: NURSING_DISCHARGE_DESCRIPTION,
      label: 'Descargar epicrisis de enfermería',
      color: 'bg-sky-100 text-sky-700',
    },
  ];

  return (
    <span
      className="inline-flex items-center gap-1"
      data-testid="rayen-discharge-badges"
      aria-busy={downloadingKey !== null}
    >
      {badges
        .filter(badge => badge.state === 'confirmed')
        .map(badge => (
          <button
            key={badge.type}
            type="button"
            onClick={() => void download(props, episode, badge.type)}
            disabled={downloadingKey !== null || !/^\d+$/.test(episode.encId)}
            className={`${badgeClassName} ${badge.color} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60`}
            title={`${badge.label} · ${badge.description}`}
            aria-label={`${badge.label} · ${badge.description}`}
          >
            {downloadingKey === `${episode.encId}:${badge.type}` ? (
              <Loader2 size={10} className="animate-spin" aria-hidden="true" />
            ) : (
              <ClipboardCheck size={10} strokeWidth={2.5} aria-hidden="true" />
            )}
          </button>
        ))}
    </span>
  );
};
