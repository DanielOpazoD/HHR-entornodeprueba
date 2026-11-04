/**
 * Read-only list of the «Alertas» notes synced from the patient's Eloísa chart. Eloísa remains
 * the place to write, edit or archive them.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { PatientClinicalAlert } from '@/types/domain/clinicalAlerts';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { clinicalAlertStamp } from './clinicalAlertStamp';

interface ClinicalAlertsModalProps {
  patientName: string;
  alerts: PatientClinicalAlert[];
  onClose: () => void;
}

const DAY_MS = 86_400_000;

/** Age on the hospital calendar, as Eloísa's panel shows it next to each note. */
const ageLabel = (day: string, today: string): string => {
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS
  );
  if (!Number.isFinite(days) || days <= 0) return 'hoy';
  return days === 1 ? 'ayer' : `hace ${days} días`;
};

export const ClinicalAlertsModal: React.FC<ClinicalAlertsModalProps> = ({
  patientName,
  alerts,
  onClose,
}) => {
  const today = getClinicalCalendarDateISO();
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={`Alertas de la ficha — ${patientName}`}
      icon={<AlertTriangle size={18} />}
      size="md"
      variant="white"
      dataModule="census-clinical-alerts"
    >
      <ul className="divide-y divide-slate-100">
        {alerts.map(alert => {
          const stamp = clinicalAlertStamp(alert.recordedAt);
          return (
            <li key={alert.id} className="py-1.5">
              <p className="whitespace-pre-wrap break-words text-sm text-slate-900">{alert.text}</p>
              <p className="text-[11px] tabular-nums text-slate-500">
                {[stamp.full, ageLabel(stamp.day, today), alert.author, alert.visitor && 'Visita']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          );
        })}
      </ul>
    </BaseModal>
  );
};
