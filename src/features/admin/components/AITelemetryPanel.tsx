import React, { useState, useEffect } from 'react';
import { aiTelemetryService, AIMetrics } from '@/services/ai/aiTelemetryService';
import {
    Activity,
    List,
    CheckCircle2,
    AlertTriangle,
    XCircle,
    Clock,
    RotateCcw,
    Zap,
    LucideIcon
} from 'lucide-react';
import clsx from 'clsx';

interface MetricCardProps {
    label: string;
    value: number | string;
    icon: LucideIcon;
    color: string;
    description?: string;
    subValue?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, icon: Icon, color, description, subValue }) => (
    <div className="group relative overflow-hidden bg-white/60 backdrop-blur-md p-5 rounded-2xl border border-white/80 shadow-sm hover:shadow-md transition-all duration-300">
        <div className={clsx("absolute top-0 right-0 p-4 opacity-10 group-hover:scale-120 transition-transform duration-500", color)}>
            <Icon size={80} />
        </div>
        <div className="relative space-y-3">
            <div className={clsx("flex items-center gap-2 font-bold uppercase tracking-wider text-[10px]", color)}>
                <Icon size={14} />
                {label}
            </div>
            <div>
                <div className="text-3xl font-black text-slate-900 leading-none">
                    {value}
                </div>
                {subValue && (
                    <div className="text-[10px] text-slate-400 font-medium mt-1">
                        {subValue}
                    </div>
                )}
            </div>
            {description && (
                <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                    {description}
                </p>
            )}
        </div>
    </div>
);

export const AITelemetryPanel: React.FC = () => {
    const [metrics, setMetrics] = useState<AIMetrics>(aiTelemetryService.getMetrics());

    useEffect(() => {
        return aiTelemetryService.subscribe(setMetrics);
    }, []);

    const successRate = metrics.totalRequests > 0
        ? ((metrics.successCount / (metrics.totalRequests - metrics.queuedRequests - metrics.activeRequests - metrics.canceledCount)) * 100).toFixed(1)
        : "100";

    const isHealthy = metrics.failedCount === 0 || (metrics.successCount / (metrics.failedCount + metrics.successCount)) > 0.8;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className={clsx(
                        "p-2 rounded-xl border animate-pulse-slow",
                        isHealthy ? "bg-emerald-50 border-emerald-100 text-emerald-600" : "bg-amber-50 border-amber-100 text-amber-600"
                    )}>
                        <Activity size={20} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">AI Service Health</h2>
                        <p className="text-xs text-slate-500 font-medium">Real-time Gemini API Monitoring</p>
                    </div>
                </div>

                <button
                    onClick={() => aiTelemetryService.reset()}
                    className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800 bg-slate-100/50 hover:bg-slate-200/50 rounded-lg transition-colors border border-slate-200/50"
                >
                    <RotateCcw size={12} />
                    Reset Metrics
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricCard
                    label="Queue Status"
                    value={metrics.queuedRequests}
                    subValue={metrics.activeRequests > 0 ? `${metrics.activeRequests} processing` : 'Idle'}
                    icon={List}
                    color="text-indigo-600"
                    description="Current requests waiting in the stability layer"
                />
                <MetricCard
                    label="Success Rate"
                    value={`${successRate}%`}
                    subValue={`${metrics.successCount} completed`}
                    icon={CheckCircle2}
                    color="text-emerald-600"
                    description="Percentage of requests successfully fullfilled"
                />
                <MetricCard
                    label="Throttling Events"
                    value={metrics.rateLimitCount}
                    icon={Clock}
                    color="text-amber-600"
                    description="Times the manager paused to respect API limits"
                />
                <MetricCard
                    label="Critical Failures"
                    value={metrics.failedCount}
                    subValue={metrics.canceledCount > 0 ? `${metrics.canceledCount} canceled` : undefined}
                    icon={metrics.failedCount > 0 ? XCircle : Zap}
                    color={metrics.failedCount > 0 ? "text-rose-600" : "text-sky-600"}
                    description="Requests that failed after max retries"
                />
            </div>

            {metrics.lastError && (
                <div className="p-4 bg-rose-50/50 border border-rose-100/50 rounded-2xl flex items-start gap-3">
                    <AlertTriangle size={16} className="text-rose-500 shrink-0 mt-0.5" />
                    <div>
                        <span className="text-xs font-bold text-rose-800 block">Last Failure Log</span>
                        <code className="text-[10px] text-rose-700/80 leading-relaxed font-mono break-all mt-1 block">
                            {metrics.lastError}
                        </code>
                    </div>
                </div>
            )}

            <div className="flex justify-center">
                <p className="text-[9px] font-mono text-slate-400 uppercase tracking-widest">
                    Last Tick: {new Date(metrics.lastUpdated).toLocaleTimeString()}
                </p>
            </div>
        </div>
    );
};
