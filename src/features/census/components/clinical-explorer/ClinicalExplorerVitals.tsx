import React from 'react';
import { Activity } from 'lucide-react';
import type { ClinicalExplorerPatient } from '@/features/census/controllers/clinicalExplorerController';
import {
  buildVitalSignsView,
  type VitalReadingView,
} from '@/features/census/controllers/vitalSignsView';
import { resolveVitalSignsProfile } from '@/utils/vitalSignsProfileResolver';
import { formatDateTimeCL } from '@/utils/dateDisplayUtils';
import { VITAL_STATUS_CARD, VITAL_STATUS_TEXT } from '../patient-row/vitalStatusTone';
import { AreaCard, EmptyNote } from './clinicalExplorerUi';

/** Latest measurement already available for this census patient and episode. */
export const ClinicalExplorerVitals: React.FC<{ patient: ClinicalExplorerPatient }> = ({
  patient,
}) => {
  const { data } = patient;
  const profile = resolveVitalSignsProfile({
    age: data.age,
    birthDate: data.birthDate,
    referenceDate: data.vitalSigns?.recordedDate,
  });
  const vitals = buildVitalSignsView(data.vitalSigns, profile);
  const pam = data.vitalSigns?.meanArterialPressure;
  const readings: Array<Omit<VitalReadingView, 'key'>> = [...(vitals?.readings ?? [])];
  if (pam != null && Number.isFinite(pam)) {
    readings.splice(readings[0]?.label === 'PA' ? 1 : 0, 0, {
      label: 'PAM',
      value: String(Math.round(pam)),
      unit: 'mmHg',
      status: 'neutral',
    });
  }

  return (
    <AreaCard
      icon={<Activity />}
      iconClassName="text-teal-700"
      title="Signos vitales"
      source="Censo · Eloísa"
    >
      {vitals && (
        <p className="text-[11px] text-slate-500">
          Última toma disponible · {formatDateTimeCL(vitals.recordedAt)}
        </p>
      )}
      {readings.length > 0 ? (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {readings.map(reading => (
            <div
              key={reading.label}
              className={`rounded-lg border px-2 py-2 text-center ${VITAL_STATUS_CARD[reading.status]}`}
            >
              <dt className="text-[11px] font-medium text-slate-500">{reading.label}</dt>
              <dd className={`text-lg font-bold tabular-nums ${VITAL_STATUS_TEXT[reading.status]}`}>
                {reading.value}
                <span className="block text-[10px] font-normal text-slate-500">{reading.unit}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <EmptyNote>Sin signos vitales disponibles en este censo.</EmptyNote>
      )}
      {vitals?.observations && <p className="text-[12px] text-slate-600">{vitals.observations}</p>}
    </AreaCard>
  );
};
