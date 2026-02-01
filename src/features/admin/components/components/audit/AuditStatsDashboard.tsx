import React from 'react';
import { Activity, Users, Zap, Clock, BarChart3 } from 'lucide-react';
import clsx from 'clsx';
import { AuditAction, AuditLogEntry } from '@/types/audit';
import { AUDIT_ACTION_LABELS } from '@/services/admin/auditConstants';
import { formatDuration, getActionCriticality } from '@/hooks/useAuditStats';

interface AuditStatsDashboardProps {
    stats: {
        todayCount: number;
        activeUserCount: number;
        criticalCount: number;
        avgSessionMinutes: number;
        totalSessionsToday: number;
        actionBreakdown: Record<string, number>;
    };
    logs: AuditLogEntry[];
}

export const AuditStatsDashboard: React.FC<AuditStatsDashboardProps> = ({ stats, logs }) => {
    return (
        <div className="space-y-4">
            {/* Stats Dashboard Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Today's Activity */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                            <Activity className="text-indigo-600" size={20} />
                        </div>
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                            Hoy
                        </span>
                    </div>
                    <p className="text-2xl font-bold text-slate-900">{stats.todayCount}</p>
                    <p className="text-xs text-slate-500 mt-1">Eventos registrados</p>
                </div>

                {/* Active Users */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
                            <Users className="text-violet-600" size={20} />
                        </div>
                        <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">
                            {stats.totalSessionsToday} sesiones
                        </span>
                    </div>
                    <p className="text-2xl font-bold text-slate-900">{stats.activeUserCount}</p>
                    <p className="text-xs text-slate-500 mt-1">Usuarios activos hoy</p>
                </div>

                {/* Critical Actions */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <div className={clsx(
                            "w-10 h-10 rounded-xl flex items-center justify-center",
                            stats.criticalCount > 0 ? "bg-amber-50" : "bg-slate-50"
                        )}>
                            <Zap className={stats.criticalCount > 0 ? "text-amber-600" : "text-slate-400"} size={20} />
                        </div>
                        {stats.criticalCount > 0 && (
                            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                                Importante
                            </span>
                        )}
                    </div>
                    <p className="text-2xl font-bold text-slate-900">{stats.criticalCount}</p>
                    <p className="text-xs text-slate-500 mt-1">Acciones críticas hoy</p>
                </div>

                {/* Avg Session Time */}
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center">
                            <Clock className="text-sky-600" size={20} />
                        </div>
                    </div>
                    <p className="text-2xl font-bold text-slate-900">
                        {stats.avgSessionMinutes > 0 ? formatDuration(stats.avgSessionMinutes) : '-'}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">Tiempo promedio sesión</p>
                </div>
            </div>

            {/* Action Breakdown Row */}
            <div className="grid grid-cols-1 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                            <BarChart3 size={16} className="text-slate-400" />
                            Desglose por Tipo
                        </h3>
                        <span className="text-[10px] text-slate-400">Últimos {logs.length} registros</span>
                    </div>
                    <div className="space-y-2">
                        {Object.entries(stats.actionBreakdown)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 6)
                            .map(([action, count]) => {
                                const criticality = getActionCriticality(action as AuditAction);
                                const percentage = Math.round((count / logs.length) * 100);
                                return (
                                    <div key={action} className="flex items-center gap-3">
                                        <div className={clsx(
                                            "w-1.5 h-6 rounded-full",
                                            criticality === 'critical' ? "bg-rose-500" :
                                                criticality === 'important' ? "bg-amber-500" : "bg-slate-300"
                                        )} />
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-xs font-medium text-slate-700">
                                                    {AUDIT_ACTION_LABELS[action as AuditAction] || action}
                                                </span>
                                                <span className="text-xs font-bold text-slate-500">{count}</span>
                                            </div>
                                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                <div
                                                    className={clsx(
                                                        "h-full rounded-full transition-all",
                                                        criticality === 'critical' ? "bg-rose-400" :
                                                            criticality === 'important' ? "bg-amber-400" : "bg-slate-300"
                                                    )}
                                                    style={{ width: `${percentage}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                    </div>
                    <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-100">
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-rose-500" />
                            <span className="text-[10px] text-slate-500">Crítico</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full bg-slate-300" />
                            <span className="text-[10px] text-slate-500">Info</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
