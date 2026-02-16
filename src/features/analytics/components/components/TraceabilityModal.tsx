/**
 * TraceabilityModal Component
 * Shows a list of patients that contributed to a specific statistic
 */

import React from 'react';
import { BaseModal } from '@/components/shared/BaseModal';
import { PatientTraceability } from '@/types/minsalTypes';
import { Users, Calendar, BedDouble } from 'lucide-react';
import { formatDateDDMMYYYY } from '@/utils/dateUtils';

interface TraceabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  patients: PatientTraceability[];
  type: 'dias-cama' | 'egresos' | 'fallecidos' | 'traslados' | 'aerocardal' | 'fach';
}

export const TraceabilityModal: React.FC<TraceabilityModalProps> = ({
  isOpen,
  onClose,
  title,
  patients,
  type,
}) => {
  // Sort by date (descending)
  const sortedPatients = [...patients].sort((a, b) => b.date.localeCompare(a.date));

  // Grouping logic for 'dias-cama'
  const uniquePatients = React.useMemo(() => {
    if (type !== 'dias-cama') return [];

    const map = new Map<
      string,
      {
        patient: PatientTraceability;
        daysCount: number;
        dates: string[];
      }
    >();

    patients.forEach(p => {
      const key = p.rut; // Group by RUT
      const existing = map.get(key);
      if (existing) {
        existing.daysCount++;
        existing.dates.push(p.date);
        // Keep the record with admissionDate if available
        if (!existing.patient.admissionDate && p.admissionDate) {
          existing.patient = p; // Update reference to have admission date
        }
      } else {
        map.set(key, {
          patient: p,
          daysCount: 1,
          dates: [p.date],
        });
      }
    });

    return Array.from(map.values()).sort(
      (a, b) =>
        // Sort by days count desc, then name
        b.daysCount - a.daysCount || a.patient.name.localeCompare(b.patient.name)
    );
  }, [patients, type]);

  const isGroupedView = type === 'dias-cama';

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon={<Users size={20} />}
      size="2xl"
      bodyClassName="p-0 space-y-0"
    >
      <>
        {patients.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            No hay registros detallados disponibles.
          </div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
              <tr>
                {isGroupedView ? (
                  <>
                    <th className="pl-8 pr-4 py-3 font-medium text-slate-600 border-b">Paciente</th>
                    <th className="px-4 py-3 font-medium text-slate-600 border-b">RUT</th>
                    <th className="px-4 py-3 font-medium text-slate-600 border-b">Ingreso</th>
                    <th className="px-4 py-3 font-medium text-slate-600 border-b">Egreso</th>
                    <th className="pl-4 pr-8 py-3 font-medium text-slate-600 border-b text-center">
                      Días en Periodo
                    </th>
                  </>
                ) : (
                  <>
                    <th className="pl-8 pr-4 py-3 font-medium text-slate-600 border-b">
                      Fecha Evento
                    </th>
                    <th className="px-4 py-3 font-medium text-slate-600 border-b">Paciente</th>
                    <th className="px-4 py-3 font-medium text-slate-600 border-b">RUT</th>
                    <th className="pl-4 pr-8 py-3 font-medium text-slate-600 border-b">
                      Ubicación
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isGroupedView
                ? // GROUPED VIEW (Unique Patients)
                  uniquePatients.map((item, idx) => (
                    <tr
                      key={`${item.patient.rut}-${idx}`}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="pl-8 pr-4 py-2.5 font-medium text-slate-800 align-top">
                        {item.patient.name}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 font-mono text-xs align-top">
                        {item.patient.rut}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap align-top">
                        <div className="flex items-center gap-2">
                          <Calendar size={14} className="text-slate-400" />
                          {item.patient.admissionDate ? (
                            formatDateDDMMYYYY(item.patient.admissionDate)
                          ) : (
                            <span className="text-slate-400 italic">--</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap align-top">
                        {item.patient.dischargeDate ? (
                          <div className="flex items-center gap-2">
                            <Calendar size={14} className="text-slate-400" />
                            {formatDateDDMMYYYY(item.patient.dischargeDate)}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">--</span>
                        )}
                      </td>
                      <td className="pl-4 pr-8 py-2.5 text-center font-semibold text-sky-700 align-top">
                        {item.daysCount}
                      </td>
                    </tr>
                  ))
                : // STANDARD VIEW (Event List)
                  sortedPatients.map((p, idx) => (
                    <tr
                      key={`${p.rut}-${p.date}-${idx}`}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="pl-8 pr-4 py-2.5 text-slate-600 whitespace-nowrap align-top">
                        <div className="flex items-center gap-2">
                          <Calendar size={14} className="text-slate-400" />
                          {formatDateDDMMYYYY(p.date)}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-800 align-top">{p.name}</td>
                      <td className="px-4 py-2.5 text-slate-500 font-mono text-xs align-top">
                        {p.rut}
                      </td>
                      <td className="pl-4 pr-8 py-2.5 text-slate-600 align-top">
                        {p.bedName ? (
                          <div className="flex items-center gap-1.5">
                            <BedDouble size={14} className="text-slate-400" />
                            {p.bedName}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">--</span>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        )}
      </>
    </BaseModal>
  );
};
