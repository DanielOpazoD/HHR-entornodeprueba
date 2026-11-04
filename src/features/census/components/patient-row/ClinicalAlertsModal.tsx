/**
 * Read-only list of the «Alertas» notes synced from the patient's Eloísa chart. Eloísa remains
 * the place to write, edit or archive them.
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { PatientClinicalAlert } from '@/types/domain/clinicalAlerts';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';

interface ClinicalAlertsModalProps {
  patientName: string;
  alerts: PatientClinicalAlert[];
  onClose: () => void;
}

const DAY_MS = 86_400_000;

/** `recordedAt` is already the Rapa Nui wall clock (`YYYY-MM-DDTHH:mm`), never an instant. */
const wallClock = (recordedAt: string) => {
  const [day = '', time = ''] = recordedAt.split('T');
  return { day, label: `${day.split('-').reverse().join('-')} ${time}` };
};

/** Age on the hospital calendar, as Eloísa's panel shows it next to each note. */
const ageLabel = (day: string, today: string): string => {
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / DAY_MS
  );
  if (!Number.isFinite(days) || days <= 0) return 'Hoy';
  return days === 1 ? 'Ayer' : `Hace ${days} días`;
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
      <ul className="space-y-2">
        {alerts.map(alert => {
          const stamp = wallClock(alert.recordedAt);
          return (
            <li
              key={alert.id}
              className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm"
            >
              <div className="flex items-start justify-between gap-3 text-xs text-slate-600">
                <span>
                  {[alert.role, alert.author].filter(Boolean).join(' ') || 'Autor no informado'}
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  {ageLabel(stamp.day, today)} · {stamp.label}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-slate-900">{alert.text}</p>
              {alert.visitor && (
                <span className="mt-1 inline-block rounded bg-medical-100 px-1.5 py-0.5 text-[10px] font-semibold text-medical-800">
                  Visita
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-slate-500">
        Copia de la ficha de Eloísa al sincronizar el censo de este día. Para agregar, editar o
        archivar una alerta, usa Eloísa.
      </p>
    </BaseModal>
  );
};
