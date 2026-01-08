import React from 'react';
import { useDevMetrics } from '@/hooks/useDevMetrics';
import {
    Trophy,
    Terminal,
    ShieldCheck,
    Zap,
    Activity,
    AlertCircle,
    ChevronRight,
    Target,
    Code2
} from 'lucide-react';
import clsx from 'clsx';

const CoverageBadge: React.FC<{ label: string; value: number; threshold: number }> = ({ label, value, threshold }) => {
    const isHealthy = value >= threshold;
    return (
        <div className="flex flex-col gap-2 p-4 bg-white/40 backdrop-blur-sm rounded-2xl border border-white/60 shadow-sm">
            <div className="flex justify-between items-center text-xs font-bold uppercase tracking-wider text-slate-500">
                <span>{label}</span>
                <span className={clsx(isHealthy ? "text-emerald-600" : "text-amber-600")}>
                    {value.toFixed(1)}%
                </span>
            </div>
            <div className="h-2 w-full bg-slate-200/50 rounded-full overflow-hidden">
                <div
                    className={clsx(
                        "h-full transition-all duration-1000 ease-out rounded-full",
                        isHealthy ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]" : "bg-amber-500"
                    )}
                    style={{ width: `${Math.min(100, (value / threshold) * 80)}%` }} // Scaled visually
                />
            </div>
            <div className="text-[10px] text-slate-400 font-medium italic">
                Meta: {threshold}%
            </div>
        </div>
    );
};

export const DevDashboard: React.FC = () => {
    const { metrics, loading } = useDevMetrics();

    if (loading || !metrics) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] animate-pulse">
                <Terminal size={40} className="text-slate-300 mb-4" />
                <div className="h-4 w-48 bg-slate-200 rounded-full mb-2" />
                <div className="h-3 w-32 bg-slate-100 rounded-full" />
            </div>
        );
    }

    const { testStats, coverage, healthScore } = metrics;

    return (
        <div className="p-8 max-w-6xl mx-auto space-y-8 animate-fade-in">
            {/* Header with Health Score */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                <div className="flex items-center gap-5">
                    <div className="relative">
                        <div className="absolute -inset-1 bg-gradient-to-r from-medical-500 to-indigo-500 rounded-2xl blur opacity-25" />
                        <div className="relative p-4 bg-white rounded-2xl border border-slate-100 shadow-sm">
                            <Activity size={32} className="text-medical-600" />
                        </div>
                    </div>
                    <div>
                        <h1 className="text-3xl font-display font-black text-slate-950 tracking-tight">System Engineering Health</h1>
                        <p className="text-slate-500 font-medium flex items-center gap-2">
                            <code className="bg-slate-100 px-2 py-0.5 rounded text-xs font-mono font-bold">COMMIT_MAIN_STABLE</code>
                            <span className="w-1 h-1 bg-slate-300 rounded-full" />
                            Developer Analytics Dashboard
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4 bg-white/80 backdrop-blur border border-white p-2 rounded-2xl shadow-sm">
                    <div className="px-4 py-2 bg-slate-950 text-white rounded-xl flex items-center gap-3">
                        <Trophy size={18} className="text-amber-400" />
                        <div className="flex flex-col">
                            <span className="text-[14px] font-black leading-none">RANK {healthScore}</span>
                            <span className="text-[9px] uppercase tracking-widest text-slate-400">Project Integrity</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Primary Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="group relative overflow-hidden card p-6 bg-gradient-to-br from-emerald-50 to-white border-emerald-100/50">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform duration-500">
                        <ShieldCheck size={100} />
                    </div>
                    <div className="relative space-y-4">
                        <div className="flex items-center gap-3 text-emerald-600 font-bold uppercase tracking-wider text-xs">
                            <ShieldCheck size={16} />
                            Test Integrity
                        </div>
                        <div>
                            <div className="text-4xl font-black text-slate-900 leading-none">
                                {testStats.successRate.toFixed(0)}<span className="text-xl text-slate-400">%</span>
                            </div>
                            <p className="text-sm text-slate-500 font-medium mt-1">
                                {testStats.passed} of {testStats.total} tests passing
                            </p>
                        </div>
                    </div>
                </div>

                <div className="group relative overflow-hidden card p-6 bg-gradient-to-br from-indigo-50 to-white border-indigo-100/50">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform duration-500">
                        <Target size={100} />
                    </div>
                    <div className="relative space-y-4">
                        <div className="flex items-center gap-3 text-indigo-600 font-bold uppercase tracking-wider text-xs">
                            <Target size={16} />
                            Primary Coverage
                        </div>
                        <div>
                            <div className="text-4xl font-black text-slate-900 leading-none">
                                {coverage.statements.toFixed(1)}<span className="text-xl text-slate-400">%</span>
                            </div>
                            <p className="text-sm text-slate-500 font-medium mt-1">
                                Statment-level depth
                            </p>
                        </div>
                    </div>
                </div>

                <div className="group relative overflow-hidden card p-6 bg-gradient-to-br from-amber-50 to-white border-amber-100/50">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform duration-500">
                        <Zap size={100} />
                    </div>
                    <div className="relative space-y-4">
                        <div className="flex items-center gap-3 text-amber-600 font-bold uppercase tracking-wider text-xs">
                            <Zap size={16} />
                            Complexity Debt
                        </div>
                        <div>
                            <div className="text-4xl font-black text-slate-900 leading-none">
                                B+
                            </div>
                            <p className="text-sm text-slate-500 font-medium mt-1">
                                Estimated Refactor Necessity
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Detailed Coverage Matrix */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-3 space-y-6">
                    <div className="flex items-center gap-2 mb-2">
                        <Code2 size={20} className="text-slate-400" />
                        <h2 className="text-xl font-bold text-slate-800">Coverage Matrix</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <CoverageBadge label="Statements" value={coverage.statements} threshold={62} />
                        <CoverageBadge label="Functions" value={coverage.functions} threshold={49} />
                        <CoverageBadge label="Lines" value={coverage.lines} threshold={63} />
                        <CoverageBadge label="Branches" value={coverage.branches} threshold={48} />
                    </div>
                </div>

                {/* Action Center */}
                <div className="space-y-4">
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Mission Priority</h3>
                    <div className="space-y-3">
                        <div className="group flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl hover:border-medical-200 hover:bg-medical-50/50 transition-all cursor-pointer">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-medical-100 text-medical-600 rounded-lg group-hover:scale-110 transition-transform">
                                    <Target size={16} />
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-sm font-bold text-slate-800">Fix Coverage Threshold</span>
                                    <span className="text-[10px] text-slate-500">StatsSummary.tsx needs tests</span>
                                </div>
                            </div>
                            <ChevronRight size={16} className="text-slate-300 group-hover:translate-x-1 transition-transform" />
                        </div>

                        {coverage.functions < 49 ? (
                            <div className="flex items-start gap-3 p-4 bg-amber-50/50 border border-amber-100/50 rounded-2xl">
                                <AlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                                <div className="flex flex-col">
                                    <span className="text-xs font-bold text-amber-800">Almost there!</span>
                                    <span className="text-[10px] text-amber-700/70 leading-relaxed mt-1">
                                        Functions coverage at {coverage.functions.toFixed(1)}%. Just {(49 - coverage.functions).toFixed(1)}% more to reach threshold.
                                    </span>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-start gap-3 p-4 bg-emerald-50/50 border border-emerald-100/50 rounded-2xl">
                                <ShieldCheck size={18} className="text-emerald-500 shrink-0 mt-0.5" />
                                <div className="flex flex-col">
                                    <span className="text-xs font-bold text-emerald-800">Functions threshold reached!</span>
                                    <span className="text-[10px] text-emerald-700/70 leading-relaxed mt-1">
                                        Continue improving statement/line coverage.
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Footer Info */}
            <div className="flex justify-center pt-8 border-t border-slate-100">
                <p className="text-[11px] font-mono text-slate-400 uppercase tracking-widest">
                    Last analysis: {new Date(metrics.lastRun).toLocaleString()}
                </p>
            </div>
        </div>
    );
};
