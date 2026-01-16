import { useState, useEffect } from 'react';
import {
    Users,
    ShieldCheck,
    AlertCircle,
    Cloud,
    CloudOff,
    RefreshCw,
    Clock,
    Bug,
    User,
    ChevronRight,
    Search,
    Wifi,
    WifiOff
} from 'lucide-react';
import { subscribeToSystemHealth, UserHealthStatus } from '@/services/admin/healthService';
import clsx from 'clsx';

export const SystemHealthDashboard = () => {
    const [stats, setStats] = useState<UserHealthStatus[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        const unsubscribe = subscribeToSystemHealth((data) => {
            setStats(data);
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const filteredStats = stats.filter(u =>
        u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.displayName.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const getHealthColor = (u: UserHealthStatus) => {
        if (u.localErrorCount > 10 || u.pendingMutations > 5) return 'from-red-50 to-red-100 border-red-200';
        if (u.localErrorCount > 0 || u.pendingMutations > 0) return 'from-amber-50 to-amber-100 border-amber-200';
        return 'from-emerald-50 to-white border-emerald-100';
    };

    const getHealthBadge = (u: UserHealthStatus) => {
        if (u.localErrorCount > 10 || u.pendingMutations > 5) return { label: 'CRÍTICO', color: 'bg-red-500 text-white' };
        if (u.localErrorCount > 0 || u.pendingMutations > 0) return { label: 'ADVERTENCIA', color: 'bg-amber-500 text-white' };
        return { label: 'SALUDABLE', color: 'bg-emerald-500 text-white' };
    };

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="flex items-center gap-5">
                    <div className="relative">
                        <div className="absolute -inset-1 bg-gradient-to-r from-medical-500 to-indigo-500 rounded-2xl blur opacity-25" />
                        <div className="relative p-4 bg-white rounded-2xl border border-slate-100 shadow-sm">
                            <Users size={32} className="text-medical-600" />
                        </div>
                    </div>
                    <div>
                        <h1 className="text-3xl font-display font-black text-slate-950 tracking-tight">Salud del Sistema</h1>
                        <p className="text-slate-500 font-medium">Panel de Monitoreo de Sincronización y Errores Locales</p>
                    </div>
                </div>

                <div className="relative w-full md:w-80">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por usuario..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-medical-500/20 focus:border-medical-500 outline-none transition-all"
                    />
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-40">
                    <RefreshCw className="animate-spin text-medical-500 mb-4" size={40} />
                    <p className="text-slate-400 font-medium animate-pulse">Cargando telemetría de usuarios...</p>
                </div>
            ) : filteredStats.length === 0 ? (
                <div className="card p-20 flex flex-col items-center justify-center text-slate-400">
                    <Users size={48} className="mb-4 opacity-20" />
                    <p className="text-lg font-medium">No hay datos de salud disponibles.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredStats.map((u) => {
                        const health = getHealthBadge(u);
                        const isOffline = !u.isOnline;

                        return (
                            <div key={u.uid} className={clsx(
                                "group relative overflow-hidden card p-0 bg-gradient-to-br transition-all duration-300 hover:shadow-xl hover:-translate-y-1",
                                getHealthColor(u)
                            )}>
                                {/* Status Banner */}
                                <div className={clsx("px-4 py-1.5 flex justify-between items-center text-[10px] font-black tracking-widest uppercase", health.color)}>
                                    <span>{health.label}</span>
                                    {u.isOutdated && <span className="bg-white/20 px-2 rounded">OBSOLETO</span>}
                                </div>

                                <div className="p-5 space-y-4">
                                    {/* User Info */}
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm border border-slate-100">
                                                <User size={20} className="text-slate-400" />
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-slate-900 leading-none">{u.displayName}</h3>
                                                <p className="text-xs text-slate-500 mt-1 max-w-[150px] truncate">{u.email}</p>
                                            </div>
                                        </div>
                                        <div className={clsx(
                                            "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px] font-bold border",
                                            isOffline ? "bg-red-50 text-red-600 border-red-100" : "bg-emerald-50 text-emerald-600 border-emerald-100"
                                        )}>
                                            {isOffline ? <WifiOff size={12} /> : <Wifi size={12} />}
                                            {isOffline ? 'OFFLINE' : 'ONLINE'}
                                        </div>
                                    </div>

                                    <div className="h-px bg-slate-200/50" />

                                    {/* Metrics */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Pendientes</p>
                                            <div className="flex items-center gap-2">
                                                <Cloud className={clsx(u.pendingMutations > 0 ? "text-amber-500" : "text-slate-300")} size={16} />
                                                <span className={clsx("text-lg font-black", u.pendingMutations > 0 ? "text-amber-600" : "text-slate-700")}>
                                                    {u.pendingMutations}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Errores Locales</p>
                                            <div className="flex items-center gap-2">
                                                <Bug className={clsx(u.localErrorCount > 0 ? "text-red-500" : "text-slate-300")} size={16} />
                                                <span className={clsx("text-lg font-black", u.localErrorCount > 0 ? "text-red-600" : "text-slate-700")}>
                                                    {u.localErrorCount}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Metadata */}
                                    <div className="pt-2 flex items-center justify-between text-[10px] font-medium text-slate-400 italic">
                                        <div className="flex items-center gap-1">
                                            <ShieldCheck size={12} /> {u.appVersion}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Clock size={12} /> {new Date(u.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    </div>
                                </div>

                                <div className="absolute bottom-0 left-0 w-full h-1 bg-white/20" />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
