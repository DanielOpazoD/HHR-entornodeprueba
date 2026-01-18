import React from 'react';
import { Clock } from 'lucide-react';
import clsx from 'clsx';
import { AuditLogEntry } from '@/types/audit';
import { AUDIT_ACTION_LABELS } from '@/services/admin/auditService';
import { getActionCriticality } from '@/hooks/useAuditStats';
import { actionColors, parseAuditTimestamp } from './auditUIUtils';

interface AuditTimelineProps {
    logs: AuditLogEntry[];
}

export const AuditTimeline: React.FC<AuditTimelineProps> = ({ logs }) => {
    // Group logs by user for timeline
    const userActivity: Record<string, AuditLogEntry[]> = {};
    logs.forEach(log => {
        const userId = log.userId || 'unknown';
        if (userId.includes('anonymous')) return;
        if (!userActivity[userId]) userActivity[userId] = [];
        userActivity[userId].push(log);
    });

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                    <Clock className="text-violet-600" size={20} />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-slate-800">Timeline de Sesiones</h3>
                    <p className="text-xs text-slate-500">Actividad de usuarios por sesión</p>
                </div>
            </div>

            <div className="space-y-6">
                {Object.entries(userActivity)
                    .filter(([userId]) => !userId.includes('anonymous'))
                    .sort((a, b) => {
                        const lastA = parseAuditTimestamp(a[1][0]?.timestamp || 0).getTime();
                        const lastB = parseAuditTimestamp(b[1][0]?.timestamp || 0).getTime();
                        return lastB - lastA;
                    })
                    .slice(0, 5)
                    .map(([userId, userLogs]) => {
                        const loginEvent = userLogs.find(l => l.action === 'USER_LOGIN');
                        const sortedLogs = [...userLogs].sort((a, b) =>
                            parseAuditTimestamp(a.timestamp).getTime() - parseAuditTimestamp(b.timestamp).getTime()
                        );

                        return (
                            <div key={userId} className="border border-slate-100 rounded-xl p-4">
                                {/* User Header */}
                                <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center text-sm font-bold text-violet-700">
                                            {userId.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-700">{userId.split('@')[0]}</p>
                                            <p className="text-[10px] text-slate-400">{userId}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-xs font-bold text-slate-600">{userLogs.length} acciones</p>
                                        {loginEvent?.ipAddress && (
                                            <p className="text-[10px] text-slate-400 font-mono">IP: {loginEvent.ipAddress}</p>
                                        )}
                                    </div>
                                </div>

                                {/* Timeline */}
                                <div className="relative pl-6">
                                    <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-slate-200" />
                                    {sortedLogs.slice(0, 10).map((log) => (
                                        <div key={log.id} className="relative mb-3 last:mb-0">
                                            <div className={clsx(
                                                "absolute -left-4 w-3 h-3 rounded-full border-2 border-white shadow-sm",
                                                log.action === 'USER_LOGIN' ? "bg-emerald-500" :
                                                    log.action === 'USER_LOGOUT' ? "bg-rose-500" :
                                                        getActionCriticality(log.action) === 'critical' ? "bg-amber-500" :
                                                            "bg-slate-300"
                                            )} />
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-slate-400 font-mono w-12">
                                                        {parseAuditTimestamp(log.timestamp).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                    <span className={clsx(
                                                        "text-xs font-medium px-2 py-0.5 rounded",
                                                        actionColors[log.action]
                                                    )}>
                                                        {AUDIT_ACTION_LABELS[log.action]}
                                                    </span>
                                                </div>
                                                <span className="text-[10px] text-slate-500 truncate max-w-[200px]">
                                                    {log.summary || (log.details?.patientName as string) || ''}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                    {sortedLogs.length > 10 && (
                                        <p className="text-[10px] text-slate-400 pl-4">+{sortedLogs.length - 10} más acciones...</p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
            </div>
        </div>
    );
};
