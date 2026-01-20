/**
 * SyncStatusIndicator - Visual indicator for data synchronization status
 * Shows saving, saved, and error states with animations
 */

import React from 'react';
import { Cloud, RefreshCw, Check, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';
import { useDailyRecordContext } from '../../context/DailyRecordContext';
import { useDemoMode } from '../../context/DemoModeContext';

export const SyncStatusIndicator: React.FC = () => {
    const { syncStatus, lastSyncTime } = useDailyRecordContext();
    const { isActive: isDemoMode } = useDemoMode();

    // Don't show in demo mode (already has its own badge)
    if (isDemoMode) return null;

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
                    animate: true
                };
            case 'saved':
                return {
                    icon: Check,
                    text: 'Sincronizado',
                    bgColor: 'bg-green-500/20',
                    borderColor: 'border-green-400/50',
                    textColor: 'text-green-200',
                    iconColor: 'text-green-300',
                    animate: false
                };
            case 'error':
                return {
                    icon: AlertTriangle,
                    text: 'Error',
                    bgColor: 'bg-red-500/20',
                    borderColor: 'border-red-400/50',
                    textColor: 'text-red-200',
                    iconColor: 'text-red-300',
                    animate: false
                };
            default: // idle
                return {
                    icon: Cloud,
                    text: 'Conectado',
                    bgColor: 'bg-white/10',
                    borderColor: 'border-white/20',
                    textColor: 'text-white/70',
                    iconColor: 'text-white/50',
                    animate: false
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
            className={clsx(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border transition-all duration-300',
                config.bgColor,
                config.borderColor,
                config.textColor
            )}
            title={timeString}
        >
            <Icon
                size={12}
                className={clsx(config.iconColor, config.animate && 'animate-spin')}
            />
            <span className="hidden sm:inline">{config.text}</span>
        </div>
    );
};
