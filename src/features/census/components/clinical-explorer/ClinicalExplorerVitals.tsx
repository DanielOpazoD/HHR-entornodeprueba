import React, { lazy, useState } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';
import type { ClinicalExplorerPatient } from '@/features/census/controllers/clinicalExplorerController';
import {
  buildVitalSignsView,
  type VitalReadingView,
} from '@/features/census/controllers/vitalSignsView';
import { resolveVitalSignsProfile } from '@/utils/vitalSignsProfileResolver';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { VITAL_STATUS_CARD, VITAL_STATUS_TEXT } from '../patient-row/vitalStatusTone';
import { ClinicalDetailLoadBoundary } from '../patient-row/ClinicalDetailLoadBoundary';
import { FluidBalanceDetail } from '../patient-row/FluidBalanceDetail';
import { clinicalAlertStamp } from '../patient-row/clinicalAlertStamp';
import {
  useClinicalDerivedDayRevision,
  useClinicalDerivedEpisodeGeneration,
} from '../patient-row/clinicalDerivedDayContext';
import { AreaCard, EmptyNote, LinkButton } from './clinicalExplorerUi';

const VitalsDetailModal = lazy(() =>
  import('../patient-row/VitalsDetailModal').then(module => ({ default: module.VitalsDetailModal }))
);

/** Latest census readings, with the same on-demand history and balances as the daily census. */
export const ClinicalExplorerVitals: React.FC<{
  patient: ClinicalExplorerPatient;
  censusDate: string;
}> = ({ patient, censusDate }) => {
  const { data, episodeId } = patient;
  const scope = `${censusDate}:${data.rut}:${episodeId}`;
  const [opened, setOpened] = useState<string | null>(null);
  if (opened && opened !== scope) setOpened(null);
  const layoutGeneration = useClinicalDerivedEpisodeGeneration(episodeId);
  const dayRevision = useClinicalDerivedDayRevision();
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
  const alerts = data.clinicalAlerts ?? [];
  const showHistory = () => setOpened(scope);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <AreaCard
        icon={<Activity />}
        title="Signos vitales"
        onTitleClick={showHistory}
        actions={<LinkButton onClick={showHistory}>Ver historial</LinkButton>}
      >
        {vitals && (
          <p className="text-[11px] tabular-nums text-slate-500">
            {formatDateDDMMYYYY(vitals.recordedDate)}
          </p>
        )}
        {readings.length > 0 ? (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-none sm:grid-flow-col sm:auto-cols-[minmax(max-content,1fr)] overflow-x-auto pb-0.5">
            {readings.map(reading => (
              <button
                type="button"
                key={reading.label}
                onClick={showHistory}
                aria-label={`${reading.label}: ${reading.value} ${reading.unit}. Ver historial`}
                className={`rounded-lg border px-1 py-1.5 text-center hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${VITAL_STATUS_CARD[reading.status]}`}
              >
                <span className="block text-[11px] font-medium text-slate-500">
                  {reading.label}
                </span>
                <span
                  className={`block font-semibold tabular-nums ${readings.length > 4 ? 'text-sm' : 'text-xl'} ${VITAL_STATUS_TEXT[reading.status]}`}
                >
                  {reading.value}
                  <span className="block text-[10px] font-normal text-slate-500">
                    {reading.unit}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyNote>Sin signos vitales disponibles en este censo.</EmptyNote>
        )}
        {vitals?.observations && (
          <p className="text-[12px] text-slate-600">{vitals.observations}</p>
        )}
        <FluidBalanceDetail key={scope} balance={data.fluidBalance} censusDate={censusDate} />
      </AreaCard>
      <AreaCard icon={<AlertTriangle />} title="Alertas">
        {alerts.length ? (
          <ul className="divide-y divide-slate-100">
            {alerts.map(alert => (
              <li key={alert.id} className="py-1 first:pt-0 last:pb-0">
                <p className="whitespace-pre-wrap break-words text-[12px] text-slate-800">
                  {alert.text}
                </p>
                <p className="text-[11px] tabular-nums text-slate-500">
                  {[
                    clinicalAlertStamp(alert.recordedAt).full,
                    alert.author,
                    alert.visitor && 'Visita',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyNote>Sin alertas registradas en este censo.</EmptyNote>
        )}
      </AreaCard>
      {opened === scope && (
        <ClinicalDetailLoadBoundary
          title={`Signos vitales — ${data.patientName}`}
          size="lg"
          onClose={() => setOpened(null)}
        >
          <VitalsDetailModal
            key={scope}
            patientName={data.patientName}
            vitals={vitals ?? undefined}
            fluidBalance={data.fluidBalance}
            censusDate={censusDate}
            vitalSignsHistory={data.vitalSignsHistory}
            latestReading={data.vitalSigns}
            episodeDocument={
              layoutGeneration
                ? { date: censusDate, clinicalEpisodeId: episodeId, layoutGeneration, dayRevision }
                : undefined
            }
            age={data.age}
            birthDate={data.birthDate}
            profile={profile}
            onClose={() => setOpened(null)}
          />
        </ClinicalDetailLoadBoundary>
      )}
    </div>
  );
};
