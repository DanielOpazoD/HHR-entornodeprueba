/**
 * Detail modal for the census "Signos vitales" column — the latest vital signs synced from Ficha
 * Médico, shown as reading cards colored by out-of-range status (normal / warn / alert), with the
 * observations and the time they were taken. Informational only (source of truth is Ficha Médico).
 */

import React from 'react';
import clsx from 'clsx';
import { Activity } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { VitalSignsView, VitalStatus } from '@/features/census/controllers/vitalSignsView';

interface VitalsDetailModalProps {
  patientName: string;
  vitals: VitalSignsView;
  onClose: () => void;
}

const CARD_TOKENS: Record<VitalStatus, string> = {
  normal: 'bg-slate-50 text-slate-700 border-slate-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-300',
  alert: 'bg-red-50 text-red-700 border-red-300',
};

export const VitalsDetailModal: React.FC<VitalsDetailModalProps> = ({
  patientName,
  vitals,
  onClose,
}) => (
  <BaseModal
    isOpen
    onClose={onClose}
    title={`Signos vitales — ${patientName}`}
    icon={<Activity size={18} />}
    size="md"
    dataModule="census-vitals"
  >
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span>Última toma</span>
        <span className="tabular-nums">{vitals.recordedAt}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {vitals.readings.map(reading => (
          <div
            key={reading.key}
            className={clsx(
              'flex flex-col items-center rounded-lg border px-2 py-2',
              CARD_TOKENS[reading.status]
            )}
          >
            <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">
              {reading.label}
            </span>
            <span className="text-lg font-bold leading-tight tabular-nums">{reading.value}</span>
            <span className="text-[9px] opacity-60">{reading.unit}</span>
          </div>
        ))}
      </div>
      {vitals.observations && (
        <p className="rounded-md bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
          <span className="font-medium text-slate-500">Observaciones:</span> {vitals.observations}
        </p>
      )}
    </div>
  </BaseModal>
);
