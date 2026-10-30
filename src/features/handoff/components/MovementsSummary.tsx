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
import type { DailyRecord } from '@/domain/handoff/recordContracts';
import {
  buildMovementsSummaryViewModel,
  resolveTransferDestinationLabel,
  resolveTransferEscortLabel,
} from '@/features/handoff/controllers/movementsSummaryController';

interface MovementsSummaryProps {
  record: DailyRecord;
  selectedShift?: 'day' | 'night';
}

export const MovementsSummary: React.FC<MovementsSummaryProps> = ({
  record,
  selectedShift = 'day',
}) => {
  const movementsSummaryViewModel = useMemo(
    () => buildMovementsSummaryViewModel({ record, selectedShift }),
    [record, selectedShift]
  );
  const { discharges, transfers, cma } = movementsSummaryViewModel;

  return (
    <div className="handoff-movements min-w-0 w-full space-y-4 print:space-y-2 print:text-[11px] print:leading-tight">
      {/* Discharges - Filtered by shift */}
      <div className="handoff-movement" data-empty={discharges.items.length === 0}>
        <h3 className="handoff-movement-title">
          <UserMinus
            size={16}
            className="shrink-0 text-teal-600 print:w-4 print:h-4 print:text-red-500"
            aria-hidden="true"
          />
          Altas
        </h3>
        {discharges.items.length === 0 ? (
          <p className="handoff-movement-empty">{discharges.emptyMessage}</p>
        ) : (
          <div
            className="max-w-full overflow-x-auto print:overflow-visible"
            role="region"
            aria-label="Altas del turno"
            tabIndex={0}
          >
            <table className="handoff-movement-table">
              <thead>
                <tr>
                  <th scope="col" className="w-[8%] p-2 border-r border-slate-200 print:w-12">
                    Cama
                  </th>
                  <th scope="col" className="w-[22%] p-2 border-r border-slate-200 print:w-40">
                    Paciente / Rut
                  </th>
                  <th scope="col" className="w-[25%] p-2 border-r border-slate-200 print:w-56">
                    Diagnóstico
                  </th>
                  <th scope="col" className="w-[25%] p-2 border-r border-slate-200">
                    Tipo de alta
                  </th>
                  <th scope="col" className="w-[10%] p-2 border-r border-slate-200 print:w-20">
                    Estado
                  </th>
                  <th scope="col" className="w-[10%] p-2 print:w-20">
                    Hora Egreso
                  </th>
                </tr>
              </thead>
              <tbody>
                {discharges.items.map(d => (
                  <tr
                    key={d.id}
                    className="border-b border-slate-100 print:border-slate-300 print:text-[10px]"
                  >
                    <td className="p-2 border-r border-slate-200">{d.bedName}</td>
                    <td className="p-2 border-r border-slate-200">
                      <div className="font-medium print:text-[9px]">{d.patientName}</div>
                      <div className="text-[10px] text-slate-500 font-mono print:text-[8px]">
                        {d.rut}
                      </div>
                    </td>
                    <td className="p-2 border-r border-slate-200">{d.diagnosis}</td>
                    <td className="p-2 border-r border-slate-200">
                      {d.dischargeTypeOther || d.dischargeType}
                    </td>
                    <td className="p-2 border-r border-slate-200">{d.status}</td>
                    <td className="p-2">{d.time || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Transfers - Filtered by shift */}
      <div className="handoff-movement" data-empty={transfers.items.length === 0}>
        <h3 className="handoff-movement-title">
          <ArrowRightLeft
            size={16}
            className="shrink-0 text-teal-600 print:w-4 print:h-4 print:text-blue-500"
            aria-hidden="true"
          />
          Traslados
        </h3>
        {transfers.items.length === 0 ? (
          <p className="handoff-movement-empty">{transfers.emptyMessage}</p>
        ) : (
          <div
            className="max-w-full overflow-x-auto print:overflow-visible"
            role="region"
            aria-label="Traslados del turno"
            tabIndex={0}
          >
            <table className="handoff-movement-table">
              <thead>
                <tr>
                  <th scope="col" className="w-[8%] p-2 border-r border-slate-200 print:w-12">
                    Cama
                  </th>
                  <th scope="col" className="w-[22%] p-2 border-r border-slate-200 print:w-32">
                    Paciente / Rut
                  </th>
                  <th scope="col" className="w-[25%] p-2 border-r border-slate-200 print:w-40">
                    Diagnóstico
                  </th>
                  <th scope="col" className="w-[10%] p-2 border-r border-slate-200 print:w-20">
                    Medio
                  </th>
                  <th scope="col" className="w-[15%] p-2 border-r border-slate-200 print:w-32">
                    Centro Destino
                  </th>
                  <th scope="col" className="w-[10%] p-2 border-r border-slate-200 print:w-24">
                    Acompañante
                  </th>
                  <th scope="col" className="w-[10%] p-2 print:w-20">
                    Hora Egreso
                  </th>
                </tr>
              </thead>
              <tbody>
                {transfers.items.map(t => (
                  <tr
                    key={t.id}
                    className="border-b border-slate-100 print:border-slate-300 print:text-[10px]"
                  >
                    <td className="p-2 border-r border-slate-200">{t.bedName}</td>
                    <td className="p-2 border-r border-slate-200">
                      <div className="font-medium print:text-[9px]">{t.patientName}</div>
                      <div className="text-[10px] text-slate-500 font-mono print:text-[8px]">
                        {t.rut}
                      </div>
                    </td>
                    <td className="p-2 border-r border-slate-200">{t.diagnosis}</td>
                    <td className="p-2 border-r border-slate-200">{t.evacuationMethod}</td>
                    <td className="p-2 border-r border-slate-200">
                      {resolveTransferDestinationLabel(t)}
                    </td>
                    <td className="p-2 border-r border-slate-200">
                      {resolveTransferEscortLabel(t)}
                    </td>
                    <td className="p-2">{t.time || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* CMA - Day shift only */}
      <div className="handoff-movement" data-empty={cma.items.length === 0}>
        <h3 className="handoff-movement-title">
          <Sun
            size={16}
            className="shrink-0 text-teal-600 print:w-4 print:h-4 print:text-orange-500"
            aria-hidden="true"
          />
          Hospitalización Diurna / CMA
        </h3>
        {cma.items.length === 0 ? (
          <p className="handoff-movement-empty">{cma.emptyMessage}</p>
        ) : (
          <div
            className="max-w-full overflow-x-auto print:overflow-visible"
            role="region"
            aria-label="Hospitalización diurna / CMA"
            tabIndex={0}
          >
            <table className="handoff-movement-table">
              <thead>
                <tr>
                  <th scope="col" className="w-[8%] p-2 border-r border-slate-200 print:w-16">
                    Cama
                  </th>
                  <th scope="col" className="w-[22%] p-2 border-r border-slate-200 print:w-56">
                    Paciente / Rut
                  </th>
                  <th scope="col" className="w-[25%] p-2 border-r border-slate-200 print:w-72">
                    Diagnóstico
                  </th>
                  <th scope="col" className="w-[45%] p-2">
                    Tipo
                  </th>
                </tr>
              </thead>
              <tbody>
                {cma.items.map(c => (
                  <tr
                    key={c.id}
                    className="border-b border-slate-100 print:border-slate-300 print:text-[10px]"
                  >
                    <td className="p-2 border-r border-slate-200">{c.bedName}</td>
                    <td className="p-2 border-r border-slate-200">
                      <div className="font-medium print:text-[9px]">{c.patientName}</div>
                      <div className="text-[10px] text-slate-500 font-mono print:text-[8px]">
                        {c.rut}
                      </div>
                    </td>
                    <td className="p-2 border-r border-slate-200">{c.diagnosis}</td>
                    <td className="p-2">{c.interventionType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default MovementsSummary;
