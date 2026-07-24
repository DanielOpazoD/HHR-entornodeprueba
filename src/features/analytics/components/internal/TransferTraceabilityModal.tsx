import React from 'react';
import { PlaneTakeoff } from 'lucide-react';

import { BaseModal } from '@/components/shared/BaseModal';
import type { TransferAnalyticsDetail } from '@/features/analytics/controllers/transferAnalyticsController';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';

interface TransferTraceabilityModalProps {
  isOpen: boolean;
  title: string;
  transfers: TransferAnalyticsDetail[];
  onClose: () => void;
}

const displayValue = (value: string): React.ReactNode =>
  value ? value : <span className="italic text-slate-400">—</span>;

export const TransferTraceabilityModal: React.FC<TransferTraceabilityModalProps> = ({
  isOpen,
  title,
  transfers,
  onClose,
}) => {
  const sortedTransfers = React.useMemo(
    () =>
      transfers
        .slice()
        .sort((left, right) =>
          `${right.date}T${right.time}`.localeCompare(`${left.date}T${left.time}`)
        ),
    [transfers]
  );

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon={<PlaneTakeoff size={20} />}
      size="5xl"
      bodyClassName="p-0 space-y-0"
    >
      {sortedTransfers.length === 0 ? (
        <div className="py-12 text-center text-slate-400">No hay traslados para este grupo.</div>
      ) : (
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
              <tr>
                <th className="border-b px-4 py-3 font-medium text-slate-600">Fecha / hora</th>
                <th className="border-b px-4 py-3 font-medium text-slate-600">Paciente</th>
                <th className="border-b px-4 py-3 font-medium text-slate-600">RUT</th>
                <th className="border-b px-4 py-3 font-medium text-slate-600">Diagnóstico</th>
                <th className="border-b px-4 py-3 font-medium text-slate-600">Cama</th>
                <th className="border-b px-4 py-3 font-medium text-slate-600">Especialidad</th>
                <th className="border-b px-4 py-3 font-medium text-slate-600">Destino</th>
                <th className="border-b px-4 py-3 font-medium text-slate-600">Medio registrado</th>
                <th className="border-b px-4 py-3 font-medium text-slate-600">
                  Valor ingresado en “Otro”
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedTransfers.map(transfer => (
                <tr key={`${transfer.date}-${transfer.id}`} className="align-top hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    <div>{formatDateDDMMYYYY(transfer.date)}</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {transfer.time || 'Sin hora'}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {displayValue(transfer.patientName)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">
                    {displayValue(transfer.rut)}
                  </td>
                  <td className="max-w-xs px-4 py-3 text-slate-600">
                    {displayValue(transfer.diagnosis)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                    {displayValue(transfer.bedName)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{displayValue(transfer.specialty)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {displayValue(transfer.receivingCenter)}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-700">
                    {displayValue(transfer.evacuationMethod)}
                  </td>
                  <td className="max-w-xs px-4 py-3 text-slate-700">
                    {transfer.evacuationMethod === 'Otro'
                      ? transfer.evacuationMethodOther || (
                          <span className="font-medium text-amber-700">Otro sin especificar</span>
                        )
                      : displayValue(transfer.evacuationMethodOther)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </BaseModal>
  );
};
