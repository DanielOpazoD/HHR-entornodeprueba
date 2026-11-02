import React from 'react';
import { BellRing } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { useReminderCenter } from '@/hooks/useReminders';
import { ReminderCard } from '@/components/reminders/ReminderCard';
import { REMINDER_TYPE_LABELS, REMINDER_TYPE_STYLES } from '@/shared/reminders/reminderUiOptions';
import { formatReminderPriorityLabel } from '@/shared/reminders/reminderPresentation';

export const ReminderModal: React.FC = () => {
  const {
    reminders,
    unreadReminders,
    unreadCount,
    isOpen,
    isAvailable,
    closeCenter,
    markReminderAsRead,
  } = useReminderCenter();
  const highlightedReminder = unreadReminders[0] ?? reminders[0];

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={closeCenter}
      title="Avisos y recordatorios"
      icon={<BellRing size={20} />}
      headerIconColor="text-sky-600"
      size="3xl"
      variant="white"
      headerActions={
        highlightedReminder ? (
          <>
            <span
              className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] ${REMINDER_TYPE_STYLES[highlightedReminder.type]}`}
            >
              {REMINDER_TYPE_LABELS[highlightedReminder.type]}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">
              {formatReminderPriorityLabel(highlightedReminder.priority)}
            </span>
            {unreadCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                {unreadCount}
              </span>
            )}
          </>
        ) : null
      }
    >
      <div className="space-y-4">
        {!isAvailable && reminders.length === 0 ? (
          <div className="rounded-[1.75rem] border border-amber-200 bg-amber-50 p-10 text-center text-sm font-semibold text-amber-800">
            No fue posible cargar los avisos. Revisa permisos vigentes o despliegue de rules.
          </div>
        ) : reminders.length === 0 ? (
          <div className="rounded-[1.75rem] border border-dashed border-slate-200 bg-slate-50 p-10 text-center text-sm font-semibold text-slate-500">
            No hay avisos activos para tu rol y turno.
          </div>
        ) : (
          <div className="space-y-3">
            {reminders.map(reminder => (
              <ReminderCard
                key={reminder.id}
                reminder={reminder}
                unread={unreadReminders.some(item => item.id === reminder.id)}
                onMarkAsRead={markReminderAsRead}
              />
            ))}
          </div>
        )}
      </div>
    </BaseModal>
  );
};
