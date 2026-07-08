import React from 'react';
import { BellRing } from 'lucide-react';
import clsx from 'clsx';
import { useReminderCenter } from '@/hooks/useReminders';

export const ReminderBadge: React.FC = () => {
  const { unreadCount, hasUrgentUnread, loading, isAvailable, openCenter } = useReminderCenter();
  const visibleCount = loading ? '...' : unreadCount > 99 ? '99+' : unreadCount;

  return (
    <button
      type="button"
      onClick={openCenter}
      aria-busy={loading}
      data-reminder-center-available={isAvailable ? 'true' : 'false'}
      className={clsx(
        'relative flex h-8 w-[58px] items-center justify-center gap-1.5 rounded-full border px-0 py-0 text-xs font-black transition-all',
        hasUrgentUnread
          ? 'border-rose-300 bg-rose-500/20 text-rose-50 hover:bg-rose-500/30'
          : 'border-white/20 bg-white/10 text-white/90 hover:bg-white/20'
      )}
      aria-label="Abrir avisos"
    >
      <BellRing size={14} className={hasUrgentUnread ? 'animate-pulse' : ''} />
      <span
        data-testid="reminder-badge-count"
        className={clsx(
          'w-5 rounded-full px-0 py-0.5 text-center text-[10px] leading-none',
          unreadCount > 0 ? 'bg-white text-slate-900' : 'bg-white/10 text-white/80'
        )}
      >
        {visibleCount}
      </span>
    </button>
  );
};
