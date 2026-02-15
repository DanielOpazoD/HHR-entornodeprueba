/**
 * MovementsSummary Component
 *
 * Displays summary tables for discharges (Altas), transfers (Traslados),
 * and CMA (day hospitalization) patients in the nursing handoff view.
 *
 * ## Shift Filtering Logic
 * - **Day shift**: Shows movements with time between 08:00-20:00
 * - **Night shift**: Shows movements with time between 20:00-08:00
 * - **CMA**: Always shown in day shift only (by definition it's daytime)
 */

import React, { useMemo } from 'react';
import { UserMinus, ArrowRightLeft, Sun } from 'lucide-react';
import type { DailyRecord } from '@/types';
import {
  filterCmaByShift,
  filterDischargesByShift,
  filterTransfersByShift,
} from '@/features/handoff/controllers';

interface MovementsSummaryProps {
  record: DailyRecord;
  selectedShift?: 'day' | 'night';
}

export const MovementsSummary: React.FC<MovementsSummaryProps> = ({
  record,
  selectedShift = 'day',
}) => {
  const filteredDischarges = useMemo(
    () => filterDischargesByShift(record.discharges, selectedShift),
    [record.discharges, selectedShift]
  );
  const filteredTransfers = useMemo(
    () => filterTransfersByShift(record.transfers, selectedShift),
    [record.transfers, selectedShift]
  );
  const filteredCMA = useMemo(
    () => filterCmaByShift(record.cma, selectedShift),
    [record.cma, selectedShift]
  );

  return (
    <div className="space-y-4 print:space-y-2 print:text-[11px] print:leading-tight">
      {/* Discharges - Filtered by shift */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 print:p-0 print:shadow-none print:border-none print:bg-transparent">
        <h3 className="font-bold text-lg text-slate-700 mb-2 flex items-center gap-2 print:text-sm print:mb-1 print:text-black">
          <UserMinus size={20} className="text-red-500 print:w-4 print:h-4" />
          Altas{' '}
          {selectedShift === 'night' && (
            <span className="text-sm font-normal text-slate-400">(turno noche)</span>
          )}
        </h3>
        {filteredDischarges.length === 0 ? (
          <p className="text-slate-400 italic text-sm print:text-[10px]">
            No hay altas registradas{' '}
            {selectedShift === 'day' ? 'en este turno' : 'durante la noche'}.
          </p>
        ) : (
          <table className="w-full text-left text-sm print:text-[10px] border-collapse print:[&_th]:p-1 print:[&_td]:p-1 print:table-fixed">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 text-xs uppercase font-bold">
                <th className="p-2 border-r border-slate-200 w-24 print:w-12">Cama</th>
                <th className="p-2 border-r border-slate-200 w-64 print:w-40">Paciente / Rut</th>
                <th className="p-2 border-r border-slate-200 w-80 print:w-56">Diagnóstico</th>
                <th className="p-2 border-r border-slate-200">Tipo de alta</th>
                <th className="p-2 border-r border-slate-200 w-24 print:w-20">Estado</th>
                <th className="p-2 w-24 print:w-20">Hora Egreso</th>
              </tr>
            </thead>
            <tbody>
              {filteredDischarges.map(d => (
                <tr
                  key={d.id}
                  className="border-b border-slate-100 print:border-slate-300 print:text-[10px]"
                >
                  <td className="p-2 border-r border-slate-200 truncate">{d.bedName}</td>
                  <td className="p-2 border-r border-slate-200 truncate">
                    <div className="font-medium print:text-[9px] truncate">{d.patientName}</div>
                    <div className="text-[10px] text-slate-500 font-mono print:text-[8px]">
                      {d.rut}
                    </div>
                  </td>
                  <td className="p-2 border-r border-slate-200 truncate">{d.diagnosis}</td>
                  <td className="p-2 border-r border-slate-200 truncate">
                    {d.dischargeTypeOther || d.dischargeType}
                  </td>
                  <td className="p-2 border-r border-slate-200">{d.status}</td>
                  <td className="p-2">{d.time || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Transfers - Filtered by shift */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 print:p-0 print:shadow-none print:border-none print:bg-transparent">
        <h3 className="font-bold text-lg text-slate-700 mb-2 flex items-center gap-2 print:text-sm print:mb-1 print:text-black">
          <ArrowRightLeft size={20} className="text-blue-500 print:w-4 print:h-4" />
          Traslados{' '}
          {selectedShift === 'night' && (
            <span className="text-sm font-normal text-slate-400">(turno noche)</span>
          )}
        </h3>
        {filteredTransfers.length === 0 ? (
          <p className="text-slate-400 italic text-sm print:text-[10px]">
            No hay traslados registrados{' '}
            {selectedShift === 'day' ? 'en este turno' : 'durante la noche'}.
          </p>
        ) : (
          <table className="w-full text-left text-sm print:text-[10px] border-collapse print:[&_th]:p-1 print:[&_td]:p-1 print:table-fixed">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 text-xs uppercase font-bold">
                <th className="p-2 border-r border-slate-200 w-24 print:w-12">Cama</th>
                <th className="p-2 border-r border-slate-200 w-64 print:w-32">Paciente / Rut</th>
                <th className="p-2 border-r border-slate-200 w-80 print:w-40">Diagnóstico</th>
                <th className="p-2 border-r border-slate-200 print:w-20">Medio</th>
                <th className="p-2 border-r border-slate-200 print:w-32">Centro Destino</th>
                <th className="p-2 border-r border-slate-200 print:w-24">Acompañante</th>
                <th className="p-2 w-24 print:w-20">Hora Egreso</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransfers.map(t => (
                <tr
                  key={t.id}
                  className="border-b border-slate-100 print:border-slate-300 print:text-[10px]"
                >
                  <td className="p-2 border-r border-slate-200 truncate">{t.bedName}</td>
                  <td className="p-2 border-r border-slate-200 truncate">
                    <div className="font-medium print:text-[9px] truncate">{t.patientName}</div>
                    <div className="text-[10px] text-slate-500 font-mono print:text-[8px]">
                      {t.rut}
                    </div>
                  </td>
                  <td className="p-2 border-r border-slate-200 truncate">{t.diagnosis}</td>
                  <td className="p-2 border-r border-slate-200 truncate">{t.evacuationMethod}</td>
                  <td className="p-2 border-r border-slate-200 truncate">
                    {t.receivingCenter === 'Otro' ? t.receivingCenterOther : t.receivingCenter}
                  </td>
                  <td className="p-2 border-r border-slate-200 truncate">
                    {t.evacuationMethod === 'Aerocardal' ? '-' : t.transferEscort || '-'}
                  </td>
                  <td className="p-2">{t.time || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* CMA - Day shift only */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 print:p-0 print:shadow-none print:border-none print:bg-transparent">
        <h3 className="font-bold text-lg text-slate-700 mb-2 flex items-center gap-2 print:text-sm print:mb-1 print:text-black">
          <Sun size={20} className="text-orange-500 print:w-4 print:h-4" />
          Hospitalización Diurna / CMA
        </h3>
        {filteredCMA.length === 0 ? (
          <p className="text-slate-400 italic text-sm print:text-[10px]">
            {selectedShift === 'night'
              ? 'CMA solo aplica para turno de día.'
              : 'No hay pacientes de CMA hoy.'}
          </p>
        ) : (
          <table className="w-full text-left text-sm print:text-[10px] border-collapse print:[&_th]:p-1 print:[&_td]:p-1 print:table-fixed">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 text-xs uppercase font-bold">
                <th className="p-2 border-r border-slate-200 w-24 print:w-16">Cama</th>
                <th className="p-2 border-r border-slate-200 w-64 print:w-56">Paciente / Rut</th>
                <th className="p-2 border-r border-slate-200 w-80 print:w-72">Diagnóstico</th>
                <th className="p-2">Tipo</th>
              </tr>
            </thead>
            <tbody>
              {filteredCMA.map(c => (
                <tr
                  key={c.id}
                  className="border-b border-slate-100 print:border-slate-300 print:text-[10px]"
                >
                  <td className="p-2 border-r border-slate-200 truncate">{c.bedName}</td>
                  <td className="p-2 border-r border-slate-200 truncate">
                    <div className="font-medium print:text-[9px] truncate">{c.patientName}</div>
                    <div className="text-[10px] text-slate-500 font-mono print:text-[8px]">
                      {c.rut}
                    </div>
                  </td>
                  <td className="p-2 border-r border-slate-200 truncate">{c.diagnosis}</td>
                  <td className="p-2 truncate">{c.interventionType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default MovementsSummary;
