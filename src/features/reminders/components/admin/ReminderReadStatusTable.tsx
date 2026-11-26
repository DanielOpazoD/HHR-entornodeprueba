import React from 'react';
import { BellRing } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { Reminder, ReminderReadReceipt } from '@/types/reminders';
import {
  formatReminderReceiptDate,
  formatReminderShiftLabel,
} from '@/shared/reminders/reminderPresentation';

interface ReminderReadStatusTableProps {
  reminder: Reminder | null;
  receipts: ReminderReadReceipt[];
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  onClose: () => void;
}

export const ReminderReadStatusTable: React.FC<ReminderReadStatusTableProps> = ({
  reminder,
  receipts,
  loading,
  error = null,
  onRetry,
  onClose,
}) => {
  return (
    <BaseModal
      isOpen={Boolean(reminder)}
      onClose={onClose}
      title={reminder ? `Lecturas: ${reminder.title}` : 'Lecturas'}
      icon={<BellRing size={20} />}
      headerIconColor="text-sky-600"
      size="xl"
      variant="white"
    >
      {loading ? (
        <div className="py-10 text-center text-sm font-semibold text-slate-500">Cargando...</div>
      ) : error ? (
        <div
          role="alert"
          className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-6 text-center text-sm font-semibold text-amber-800"
        >
          <p>{error}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 inline-flex items-center justify-center rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-amber-900 transition hover:bg-amber-100"
            >
              Reintentar
            </button>
          )}
        </div>
      ) : receipts.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-500">
          Todavia no hay lecturas registradas para este aviso.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[1.5rem] border border-slate-100">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
                  Usuario
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
                  Fecha / turno
                </th>
                <th className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">
                  Leido en
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {receipts.map((receipt, index) => (
                <tr
                  key={`${receipt.userId}-${receipt.dateKey ?? 'legacy'}-${receipt.shift}-${receipt.readAt}-${index}`}
                >
                  <td className="px-4 py-3 font-semibold text-slate-700">{receipt.userName}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                        {formatReminderReceiptDate(receipt)}
                      </span>
                      <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500">
                        {formatReminderShiftLabel(receipt.shift)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-500">{receipt.readAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </BaseModal>
  );
};
