/**
 * SyncStatusIndicator - Visual indicator for data synchronization status
 * Shows saving, saved, and error states with animations
 */

import React from 'react';
import { Cloud, RefreshCw, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { useDailyRecordStatus } from '@/context/DailyRecordContext';

const SYNC_STATUS_SLOT_CLASS =
  'flex h-8 w-[88px] items-center justify-center gap-1.5 rounded-full border px-0 py-0 text-[10px] font-semibold uppercase tracking-wider transition-colors duration-200';

export const SyncStatusIndicator: React.FC = () => {
  const { syncStatus, lastSyncTime } = useDailyRecordStatus();

  if (syncStatus === 'idle' || syncStatus === 'saved') {
    return (
      <div
        className={clsx(SYNC_STATUS_SLOT_CLASS, 'invisible border-transparent')}
        data-testid="sync-status-indicator-slot"
        aria-hidden="true"
      />
    );
  }

  const getStatusConfig = () => {
    switch (syncStatus) {
      case 'saving':
        return {
          icon: RefreshCw,
          text: 'Guardando',
          bgColor: 'bg-blue-500/20',
          borderColor: 'border-blue-400/50',
          textColor: 'text-blue-200',
          iconColor: 'text-blue-300',
          animate: true,
        };
      case 'error':
        return {
          icon: AlertTriangle,
          text: 'Error',
          bgColor: 'bg-red-500/20',
          borderColor: 'border-red-400/50',
          textColor: 'text-red-200',
          iconColor: 'text-red-300',
          animate: false,
        };
      default:
        return {
          icon: Cloud,
          text: 'Estado',
          bgColor: 'bg-white/[0.06]',
          borderColor: 'border-white/[0.1]',
          textColor: 'text-white/50',
          iconColor: 'text-white/40',
          animate: false,
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  const timeString = lastSyncTime
    ? `Última sync: ${lastSyncTime.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`
    : 'Esperando conexión...';

  return (
    <div
      className={clsx(SYNC_STATUS_SLOT_CLASS, config.bgColor, config.borderColor, config.textColor)}
      title={timeString}
      data-testid="sync-status-indicator-slot"
    >
      <Icon size={12} className={clsx(config.iconColor, config.animate && 'animate-spin')} />
      <span className="hidden sm:inline">{config.text}</span>
    </div>
  );
};
