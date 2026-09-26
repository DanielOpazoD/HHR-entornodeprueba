/**
 * Detail modal for the census "Signos vitales" column: the latest readings as quiet cards, plus a
 * scrollable history table grouped by day (several days of measurements), so a patient's trend is
 * easy to review at a glance. Informational only.
 */

import React from 'react';
import { Activity } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import {
  buildVitalsHistory,
  VITALS_HISTORY_COLUMNS,
  type VitalSignsView,
  type VitalSignsProfile,
} from '@/features/census/controllers/vitalSignsView';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import { resolveVitalSignsProfile } from '@/utils/vitalSignsProfileResolver';

interface VitalsDetailModalProps {
  patientName: string;
  vitals: VitalSignsView;
  history: PatientVitalSigns[];
  age?: string;
  birthDate?: string;
  profile: VitalSignsProfile;
  onClose: () => void;
}

/** "2026-07-11" → "11-07-2026" for a day-group heading. */
const dayHeading = (isoDay: string): string => {
  const m = isoDay.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : isoDay;
};

export const VitalsDetailModal: React.FC<VitalsDetailModalProps> = ({
  patientName,
  vitals,
  history,
  age,
  birthDate,
  profile,
  onClose,
}) => {
  const rows = buildVitalsHistory(history, record => {
    if (birthDate) {
      return resolveVitalSignsProfile({ age, birthDate, referenceDate: record.recordedDate });
    }

    // An undated age cannot safely reconstruct an older measurement. Keep only
    // the latest row consistent with the census cell and leave older rows neutral.
    return record.recordedDate === vitals.recordedDate && record.recordedAt === vitals.recordedAt
      ? profile
      : 'unknown';
  });
  const days = [...new Set(rows.map(row => row.recordedDate))];

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={`Signos vitales — ${patientName}`}
      icon={<Activity size={18} />}
      size="lg"
      variant="white"
      dataModule="census-vitals"
    >
      <div className="space-y-3">
        <section>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-slate-400">
            <span className="font-semibold uppercase tracking-wide">Última toma</span>
            <span className="tabular-nums">{vitals.recordedAt}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {vitals.readings.map(reading => (
              <div
                key={reading.key}
                className="flex flex-col items-center rounded-lg border border-slate-200 bg-slate-50 px-2 py-2 text-slate-700"
              >
                <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">
                  {reading.label}
                </span>
                <span className="text-lg font-bold leading-tight tabular-nums">
                  {reading.value}
                </span>
                <span className="text-[9px] opacity-60">{reading.unit}</span>
              </div>
            ))}
          </div>
          {vitals.observations && (
            <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
              <span className="font-medium text-slate-500">Observaciones:</span>{' '}
              {vitals.observations}
            </p>
          )}
        </section>

        {rows.length > 1 && (
          <section>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Historial · {rows.length} tomas
            </div>
            <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-[11px] tabular-nums">
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">Hora</th>
                    {VITALS_HISTORY_COLUMNS.map(column => (
                      <th key={column.key} className="px-2 py-1 text-center font-medium">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                {days.map(day => (
                  <tbody key={day}>
                    <tr className="bg-slate-100/70">
                      <td
                        colSpan={VITALS_HISTORY_COLUMNS.length + 1}
                        className="px-2 py-0.5 text-[10px] font-semibold text-slate-500"
                      >
                        {dayHeading(day)}
                      </td>
                    </tr>
                    {rows
                      .filter(row => row.recordedDate === day)
                      .map(row => (
                        <tr key={row.key} className="border-t border-slate-100">
                          <td className="px-2 py-1 text-left text-slate-500">
                            {row.when.split(' ')[1] || '—'}
                          </td>
                          {VITALS_HISTORY_COLUMNS.map(column => {
                            const cell = row.cells[column.key];
                            return (
                              <td
                                key={column.key}
                                className={`px-2 py-1 text-center ${cell ? 'text-slate-700' : 'text-slate-300'}`}
                              >
                                {cell ? (
                                  <span className="inline-flex items-center justify-center gap-0.5">
                                    {cell.value}
                                  </span>
                                ) : (
                                  '·'
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </tbody>
                ))}
              </table>
            </div>
          </section>
        )}
      </div>
    </BaseModal>
  );
};
