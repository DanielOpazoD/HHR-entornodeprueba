/**
 * TraceabilityModal Component
 * Shows a list of patients that contributed to a specific statistic
 */

import React from 'react';
import { BaseModal } from '@/components/shared/BaseModal';
import { PatientTraceability } from '@/types/minsalTypes';
import { Users, Calendar, BedDouble } from 'lucide-react';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { calculateDischargeStayDays } from '@/utils/clinicalDayUtils';
import { TraceabilityCmaHeader, TraceabilityCmaRows } from './TraceabilityCmaContent';

interface TraceabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  patients: PatientTraceability[];
  type:
    | 'dias-cama'
    | 'egresos'
    | 'fallecidos'
    | 'traslados'
    | 'aerocardal'
    | 'fach'
    | 'cma'
    | 'estada';
  onOpenCensusDate?: (date: string) => void;
}

const resolveAdmissionDate = (dateValue?: string): string | null => {
  if (!dateValue) return null;
  const datePart = dateValue.split('T')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null;
};

const getStayDays = (patient: PatientTraceability): number | null => {
  return calculateDischargeStayDays(patient.admissionDate, patient.dischargeDate);
};

export const TraceabilityModal: React.FC<TraceabilityModalProps> = ({
  isOpen,
  onClose,
  title,
  patients,
  type,
  onOpenCensusDate,
}) => {
  const isGroupedView = type === 'dias-cama';
  const isStayView = type === 'estada';
  const isCmaView = type === 'cma';

  const handleOpenAdmissionCensus = React.useCallback(
    (patient: PatientTraceability) => {
      const admissionDate = resolveAdmissionDate(patient.admissionDate);
      if (!admissionDate || !onOpenCensusDate) {
        return;
      }

      onOpenCensusDate(admissionDate);
      onClose();
    },
    [onClose, onOpenCensusDate]
  );

  const sortedPatients = React.useMemo(() => {
    const list = [...patients];
    if (isStayView) {
      return list.sort((a, b) => {
        const diff = (getStayDays(b) || 0) - (getStayDays(a) || 0);
        return diff || b.date.localeCompare(a.date);
      });
    }
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [patients, isStayView]);

  const uniquePatients = React.useMemo(() => {
    if (!isGroupedView) return [];

    const map = new Map<
      string,
      {
        patient: PatientTraceability;
        daysCount: number;
        dates: string[];
      }
    >();

    patients.forEach(p => {
      const key = p.rut;
      const existing = map.get(key);
      if (existing) {
        existing.daysCount++;
        existing.dates.push(p.date);
        if (!existing.patient.admissionDate && p.admissionDate) {
          existing.patient = p;
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
      (a, b) => b.daysCount - a.daysCount || a.patient.name.localeCompare(b.patient.name)
    );
  }, [patients, isGroupedView]);

  const stayStats = React.useMemo(() => {
    if (!isStayView) return { min: 0, max: 0 };
    const days = patients.map(getStayDays).filter((value): value is number => value !== null);
    if (days.length === 0) return { min: 0, max: 0 };
    return { min: Math.min(...days), max: Math.max(...days) };
  }, [patients, isStayView]);

  const hasSpecialtyAudit = React.useMemo(
    () =>
      patients.some(
        patient =>
          patient.originalSpecialty ||
          patient.reportingSpecialty ||
          patient.reportingSpecialtySource === 'manual' ||
          patient.reportingSpecialtySource === 'grouped'
      ),
    [patients]
  );

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon={<Users size={20} />}
      size={isStayView || isGroupedView || isCmaView ? '5xl' : '3xl'}
      bodyClassName="p-0 space-y-0"
    >
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
                  <th className="px-4 py-3 font-medium text-slate-600 border-b">Diagnóstico</th>
                  <th className="px-4 py-3 font-medium text-slate-600 border-b">Ingreso</th>
                  <th className="px-4 py-3 font-medium text-slate-600 border-b">Egreso</th>
                  <th className="pl-4 pr-8 py-3 font-medium text-slate-600 border-b text-center">
                    Días en Periodo
                  </th>
                </>
              ) : isStayView ? (
                <>
                  <th className="pl-8 pr-4 py-3 font-medium text-slate-600 border-b">Paciente</th>
                  <th className="px-4 py-3 font-medium text-slate-600 border-b">RUT</th>
                  <th className="px-4 py-3 font-medium text-slate-600 border-b">Ingreso</th>
                  <th className="px-4 py-3 font-medium text-slate-600 border-b">Egreso</th>
                  <th className="px-4 py-3 font-medium text-slate-600 border-b text-center">
                    Días estada
                  </th>
                  <th className="px-4 py-3 font-medium text-slate-600 border-b text-center">
                    Censo
                  </th>
                  <th className="pl-4 pr-8 py-3 font-medium text-slate-600 border-b">
                    Diagnóstico
                  </th>
                </>
              ) : isCmaView ? (
                <TraceabilityCmaHeader />
              ) : (
                <>
                  <th className="pl-8 pr-4 py-3 font-medium text-slate-600 border-b">
                    Fecha Evento
                  </th>
                  <th className="px-4 py-3 font-medium text-slate-600 border-b">Paciente</th>
                  <th className="px-4 py-3 font-medium text-slate-600 border-b">RUT</th>
                  <th className="px-4 py-3 font-medium text-slate-600 border-b">Diagnóstico</th>
                  {hasSpecialtyAudit ? (
                    <>
                      <th className="px-4 py-3 font-medium text-slate-600 border-b">
                        Especialidad original
                      </th>
                      <th className="px-4 py-3 font-medium text-slate-600 border-b">
                        Especialidad estadística
                      </th>
                    </>
                  ) : null}
                  <th className="pl-4 pr-8 py-3 font-medium text-slate-600 border-b">Ubicación</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isGroupedView ? (
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
                  <td className="px-4 py-2.5 text-slate-600 align-top">
                    {item.patient.diagnosis ? (
                      <span className="break-words">{item.patient.diagnosis}</span>
                    ) : (
                      <span className="text-slate-400 italic">--</span>
                    )}
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
            ) : isStayView ? (
              sortedPatients.map((p, idx) => {
                const stayDays = getStayDays(p);
                const isMin = stayDays !== null && stayDays === stayStats.min;
                const isMax = stayDays !== null && stayDays === stayStats.max;

                return (
                  <tr
                    key={`${p.rut}-${p.date}-${idx}`}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="pl-8 pr-4 py-2.5 font-medium text-slate-800 align-top">
                      {p.name}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 font-mono text-xs align-top">
                      {p.rut}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap align-top">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-slate-400" />
                        {p.admissionDate ? (
                          formatDateDDMMYYYY(p.admissionDate)
                        ) : (
                          <span className="text-slate-400 italic">--</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap align-top">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-slate-400" />
                        {p.dischargeDate ? (
                          formatDateDDMMYYYY(p.dischargeDate)
                        ) : (
                          <span className="text-slate-400 italic">--</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center font-semibold text-sky-700 align-top">
                      {stayDays ?? '--'}
                      {isMin ? (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-600">
                          Mínimo
                        </span>
                      ) : null}
                      {isMax ? (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-rose-600">
                          Máximo
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-center align-top">
                      {p.admissionDate && onOpenCensusDate ? (
                        <button
                          type="button"
                          onClick={() => handleOpenAdmissionCensus(p)}
                          className="inline-flex items-center justify-center rounded-lg border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100 hover:border-sky-300"
                          title="Abrir el censo diario en la fecha de ingreso"
                        >
                          Abrir censo
                        </button>
                      ) : (
                        <span className="text-slate-400 italic">--</span>
                      )}
                    </td>
                    <td className="pl-4 pr-8 py-2.5 text-slate-600 align-top">
                      {p.diagnosis ? (
                        <span className="break-words">{p.diagnosis}</span>
                      ) : (
                        <span className="text-slate-400 italic">--</span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : isCmaView ? (
              <TraceabilityCmaRows patients={sortedPatients} />
            ) : (
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
                  <td className="px-4 py-2.5 text-slate-600 align-top">
                    {p.diagnosis ? (
                      <span className="break-words">{p.diagnosis}</span>
                    ) : (
                      <span className="text-slate-400 italic">--</span>
                    )}
                  </td>
                  {hasSpecialtyAudit ? (
                    <>
                      <td className="px-4 py-2.5 text-slate-600 align-top">
                        {p.originalSpecialty || <span className="text-slate-400 italic">--</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 align-top">
                        {p.reportingSpecialty || <span className="text-slate-400 italic">--</span>}
                      </td>
                    </>
                  ) : null}
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
              ))
            )}
          </tbody>
        </table>
      )}
    </BaseModal>
  );
};

export default TraceabilityModal;
