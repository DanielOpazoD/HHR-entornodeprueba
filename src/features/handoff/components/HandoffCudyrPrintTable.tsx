import React from 'react';
import clsx from 'clsx';
import type { DailyRecord } from '@/application/shared/dailyRecordContracts';
import {
  CUDYR_DEPENDENCY_COLUMNS,
  CUDYR_RISK_COLUMNS,
  renderCudyrScore,
  resolveHandoffCudyrPrintDisplay,
} from './handoffCudyrPrintSupport';

const VerticalHeader = ({ text, colorClass }: { text: string; colorClass: string }) => (
  <th
    className={clsx(
      'relative h-44 w-6 border border-slate-300 p-0 align-bottom print:h-24 print:bg-white',
      colorClass
    )}
  >
    <div className="flex h-full w-full items-center justify-center overflow-hidden">
      <span
        className="block whitespace-nowrap text-[10px] font-bold uppercase leading-none tracking-tight print:text-[5px] print:transform-none"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        {text}
      </span>
    </div>
  </th>
);

export const HandoffCudyrPrintTable: React.FC<{
  record: DailyRecord;
  visibleBeds: Array<{ id: string; name: string; type?: string }>;
}> = ({ record, visibleBeds }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:rounded-none print:border-none print:p-0 print:shadow-none">
    <div className="overflow-x-auto print:overflow-visible">
      <table className="min-w-[720px] w-full table-fixed border-collapse border border-slate-300 text-left text-xs print:min-w-0 print:table-auto print:text-[7px]">
        <thead>
          <tr>
            <th
              colSpan={3}
              className="border border-slate-300 bg-slate-100 p-2 text-center font-bold text-slate-700 print:bg-white print:p-1"
            >
              PACIENTE
            </th>
            <th
              colSpan={CUDYR_DEPENDENCY_COLUMNS.length}
              className="border border-blue-200 bg-blue-50 p-2 text-center font-bold text-blue-800 print:border-slate-300 print:bg-white print:p-1 print:text-black"
            >
              PUNTOS DEPENDENCIA (0-3)
            </th>
            <th
              colSpan={CUDYR_RISK_COLUMNS.length}
              className="border border-red-200 bg-red-50 p-2 text-center font-bold text-red-800 print:border-slate-300 print:bg-white print:p-1 print:text-black"
            >
              PUNTOS DE RIESGO (0-3)
            </th>
            <th className="hidden border border-slate-300 bg-slate-100 p-2 text-center font-bold text-slate-700 print:table-cell print:bg-white print:p-1">
              CAT
            </th>
          </tr>
          <tr className="text-center">
            <th className="w-10 border border-slate-300 bg-slate-50 p-1 align-middle print:w-auto">
              CAMA
            </th>
            <th className="w-32 border border-slate-300 bg-slate-50 p-1 align-middle print:w-auto">
              NOMBRE
            </th>
            <th className="w-20 border border-slate-300 bg-slate-50 p-1 align-middle print:w-auto">
              RUT
            </th>
            {CUDYR_DEPENDENCY_COLUMNS.map(column => (
              <VerticalHeader key={column} text={column} colorClass="bg-blue-50 print:bg-white" />
            ))}
            {CUDYR_RISK_COLUMNS.map(column => (
              <VerticalHeader key={column} text={column} colorClass="bg-red-50 print:bg-white" />
            ))}
            <th className="w-14 border border-slate-300 bg-slate-50 p-1 align-middle print:w-auto print:bg-white print:p-0.5">
              CAT
            </th>
          </tr>
        </thead>
        <tbody>
          {visibleBeds.flatMap(bed => {
            const patient = record.beds[bed.id];
            const isUTI = bed.type === 'UTI';

            const renderRow = (
              rowKey: string,
              rowBedName: string,
              rowPatient?: typeof patient,
              isCrib = false
            ) => {
              const display = resolveHandoffCudyrPrintDisplay(record.date, rowPatient);
              const cudyr = display.visibleScores || {};
              const rowName = display.isEligible
                ? rowPatient?.patientName
                : `${rowPatient?.patientName || ''} (Bloq. CUDYR)`;

              if (!rowPatient?.patientName) {
                return (
                  <tr
                    key={rowKey}
                    className={clsx(
                      'h-8 border-b border-slate-300 print:h-6',
                      isUTI ? 'bg-yellow-50 print:bg-white' : 'bg-white'
                    )}
                  >
                    <td className="border-r border-slate-300 p-1 text-center font-bold text-slate-700">
                      {rowBedName}
                    </td>
                    <td
                      colSpan={16}
                      className="border-r border-slate-300 p-1 text-center text-[10px] italic text-slate-400 print:text-[8px]"
                    >
                      {isCrib ? 'Cuna RN sin paciente' : 'Cama disponible'}
                    </td>
                    <td className="p-1 text-center font-semibold">-</td>
                  </tr>
                );
              }

              return (
                <tr
                  key={rowKey}
                  className={clsx(
                    'h-8 border-b border-slate-300 print:h-6',
                    isUTI ? 'bg-yellow-50 print:bg-white' : 'bg-white'
                  )}
                >
                  <td className="border-r border-slate-300 p-1 text-center font-bold text-slate-700">
                    {rowBedName}
                  </td>
                  <td
                    className={clsx(
                      'max-w-[120px] truncate border-r border-slate-300 p-1 text-[10px] font-medium',
                      display.isEligible ? 'text-slate-700' : 'text-amber-700'
                    )}
                    title={rowName}
                  >
                    {rowName}
                  </td>
                  <td className="whitespace-nowrap border-r border-slate-300 p-1 text-center text-[10px]">
                    {rowPatient.rut || '-'}
                  </td>

                  <td className="border-r border-slate-300 p-1 text-center">
                    {renderCudyrScore(cudyr.changeClothes)}
                  </td>
                  <td className="border-r border-slate-300 p-1 text-center">
                    {renderCudyrScore(cudyr.mobilization)}
                  </td>
                  <td className="border-r border-slate-300 p-1 text-center">
                    {renderCudyrScore(cudyr.feeding)}
                  </td>
                  <td className="border-r border-slate-300 p-1 text-center">
                    {renderCudyrScore(cudyr.elimination)}
                  </td>
                  <td className="border-r border-slate-300 p-1 text-center">
                    {renderCudyrScore(cudyr.psychosocial)}
                  </td>
                  <td className="border-r border-slate-300 p-1 text-center">
                    {renderCudyrScore(cudyr.surveillance)}
                  </td>

                  <td className="border-r border-slate-300 p-1 text-center">
                    {renderCudyrScore(cudyr.vitalSigns)}
                  </td>
                  <td className="border-r border-slate-300 p-1 text-center">
                    {renderCudyrScore(cudyr.fluidBalance)}
                  </td>
                  <td className="border-r border-slate-300 p-1 text-center">
                    {renderCudyrScore(cudyr.oxygenTherapy)}
                  </td>
                  <td className="border-r border-slate-300 p-1 text-center">
                    {renderCudyrScore(cudyr.airway)}
                  </td>
                  <td className="border-r border-slate-300 p-1 text-center">
                    {renderCudyrScore(cudyr.proInterventions)}
                  </td>
                  <td className="border-r border-slate-300 p-1 text-center">
                    {renderCudyrScore(cudyr.skinCare)}
                  </td>
                  <td className="border-r border-slate-300 p-1 text-center">
                    {renderCudyrScore(cudyr.pharmacology)}
                  </td>
                  <td className="border-r border-slate-300 p-1 text-center">
                    {renderCudyrScore(cudyr.invasiveElements)}
                  </td>

                  <td className="p-1 text-center print:p-0.5">
                    <span
                      className={clsx(
                        'block w-full rounded px-2 py-0.5 text-xs font-bold shadow-sm print:rounded-none print:border print:bg-transparent print:px-1 print:text-[10px] print:shadow-none',
                        display.categorization.badgeColor,
                        'print:!border-black print:!bg-white print:!text-black'
                      )}
                    >
                      {display.categorization.finalCat || '-'}
                    </span>
                  </td>
                </tr>
              );
            };

            return [
              renderRow(bed.id, bed.name, patient),
              patient?.clinicalCrib
                ? renderRow(`${bed.id}-crib`, `${bed.name} (CC)`, patient.clinicalCrib, true)
                : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  </div>
);
