import React, { useState } from 'react';
import { Activity, Bug, Terminal, ShieldCheck } from 'lucide-react';
import { ErrorDashboard } from './ErrorDashboard';
import { DevDashboard } from './DevDashboard';
import { SystemHealthDashboard } from './SystemHealthDashboard';
import clsx from 'clsx';

type DiagnosticTab = 'TELEMETRY' | 'ERRORS' | 'ENGINEERING';

export const SystemDiagnosticsView: React.FC = () => {
    const [activeTab, setActiveTab] = useState<DiagnosticTab>('TELEMETRY');

    const tabs = [
        { id: 'TELEMETRY', label: 'Telemetría de Red', icon: Activity, color: 'text-emerald-500' },
        { id: 'ERRORS', label: 'Monitor de Errores', icon: Bug, color: 'text-red-500' },
        { id: 'ENGINEERING', label: 'Dev & Engineering', icon: Terminal, color: 'text-indigo-500' }
    ] as const;

    return (
        <div className="max-w-[1200px] mx-auto p-4 animate-fade-in font-sans pb-16">
            {/* Unified Header - Compact */}
            <div className="bg-slate-900 rounded-2xl p-5 mb-6 text-white relative overflow-hidden shadow-xl">
                <div className="absolute top-0 right-0 w-64 h-64 bg-medical-500/10 rounded-full -mr-32 -mt-32 blur-3xl pointer-events-none" />

                <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 shadow-inner">
                            <ShieldCheck size={24} className="text-medical-400" />
                        </div>
                        <div>
                            <h1 className="text-xl font-black tracking-tight leading-none mb-1">Diagnóstico del Sistema</h1>
                            <p className="text-[11px] text-slate-400 font-medium">Monitoreo técnico centralizado</p>
                        </div>
                    </div>

                    <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-white/10 backdrop-blur-sm self-start lg:self-center">
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={clsx(
                                        "px-4 py-1.5 rounded-lg font-bold text-xs transition-all flex items-center gap-2",
                                        isActive
                                            ? "bg-white text-slate-900 shadow-lg"
                                            : "text-slate-400 hover:text-white hover:bg-white/5"
                                    )}
                                >
                                    <Icon size={14} className={isActive ? tab.color : ""} />
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Tab Content Rendering */}
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                {activeTab === 'TELEMETRY' && <SystemHealthDashboard />}
                {activeTab === 'ERRORS' && <ErrorDashboard />}
                {activeTab === 'ENGINEERING' && <DevDashboard />}
            </div>
        </div>
    );
};
