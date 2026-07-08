import React from 'react';
import { Calendar } from 'lucide-react';

import type { PatientTraceability } from '@/types/minsalTypes';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';

export const TraceabilityCmaHeader: React.FC = () => (
  <>
    <th className="pl-8 pr-4 py-3 font-medium text-slate-600 border-b">Fecha</th>
    <th className="px-4 py-3 font-medium text-slate-600 border-b">Paciente</th>
    <th className="px-4 py-3 font-medium text-slate-600 border-b">RUT</th>
    <th className="px-4 py-3 font-medium text-slate-600 border-b">Diagnóstico</th>
    <th className="px-4 py-3 font-medium text-slate-600 border-b">Tipo</th>
    <th className="px-4 py-3 font-medium text-slate-600 border-b">Hora</th>
    <th className="px-4 py-3 font-medium text-slate-600 border-b">Especialidad original</th>
    <th className="pl-4 pr-8 py-3 font-medium text-slate-600 border-b">Especialidad estadística</th>
  </>
);

export const TraceabilityCmaRows: React.FC<{ patients: PatientTraceability[] }> = ({
  patients,
}) => (
  <>
    {patients.map((p, idx) => (
      <tr key={`${p.rut}-${p.date}-${idx}`} className="hover:bg-slate-50 transition-colors">
        <td className="pl-8 pr-4 py-2.5 text-slate-600 whitespace-nowrap align-top">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-slate-400" />
            {formatDateDDMMYYYY(p.date)}
          </div>
        </td>
        <td className="px-4 py-2.5 font-medium text-slate-800 align-top">{p.name}</td>
        <td className="px-4 py-2.5 text-slate-500 font-mono text-xs align-top">{p.rut}</td>
        <td className="px-4 py-2.5 text-slate-600 align-top">
          {p.diagnosis ? (
            <span className="break-words">{p.diagnosis}</span>
          ) : (
            <span className="text-slate-400 italic">--</span>
          )}
        </td>
        <td className="px-4 py-2.5 text-slate-600 align-top">
          {p.interventionType || <span className="text-slate-400 italic">--</span>}
        </td>
        <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap align-top">
          {p.eventTime || <span className="text-slate-400 italic">--</span>}
        </td>
        <td className="px-4 py-2.5 text-slate-600 align-top">
          {p.originalSpecialty || <span className="text-slate-400 italic">--</span>}
        </td>
        <td className="pl-4 pr-8 py-2.5 text-slate-600 align-top">
          {p.reportingSpecialty || <span className="text-slate-400 italic">--</span>}
        </td>
      </tr>
    ))}
  </>
);
