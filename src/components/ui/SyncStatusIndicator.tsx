/**
 * Sync Status Indicator
 * Shows the current synchronization status (saving, saved, error)
 */

import React from 'react';
import { Cloud, CloudOff, Loader2, Check } from 'lucide-react';
import clsx from 'clsx';

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error';

interface SyncStatusIndicatorProps {
    status: SyncStatus;
    lastSyncTime?: Date | null;
    className?: string;
}

export const SyncStatusIndicator: React.FC<SyncStatusIndicatorProps> = ({
    status,
    lastSyncTime,
    className
}) => {
    const getStatusConfig = () => {
        switch (status) {
            case 'saving':
                return {
                    icon: <Loader2 size={14} className="animate-spin" />,
                    text: 'Guardando...',
                    colorClass: 'text-blue-400 bg-blue-500/20',
                };
            case 'saved':
                return {
                    icon: <Check size={14} />,
                    text: 'Sincronizado',
                    colorClass: 'text-green-400 bg-green-500/20',
                };
            case 'error':
                return {
                    icon: <CloudOff size={14} />,
                    text: 'Error de sync',
                    colorClass: 'text-red-400 bg-red-500/20',
                };
            default:
                return {
                    icon: <Cloud size={14} />,
                    text: '',
                    colorClass: 'text-slate-400 bg-slate-500/20',
                };
        }
    };

    const config = getStatusConfig();

    // Format last sync time
    const timeString = lastSyncTime
        ? lastSyncTime.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
        : null;

    return (
        <div
            className={clsx(
                "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all duration-300",
                config.colorClass,
                className
            )}
            title={timeString ? `Última sincronización: ${timeString}` : undefined}
        >
            {config.icon}
            {config.text && (
                <span className="hidden sm:inline">{config.text}</span>
            )}
        </div>
    );
};
