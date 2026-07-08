import React, { useState } from 'react';
import { Activity, AlertTriangle, BarChart3, Radar, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { AuditView } from './AuditView';
import { FunctionsTelemetryView } from './FunctionsTelemetryView';
import { LocalErrorLogsView } from './LocalErrorLogsView';
import { SystemHealthDashboard } from './SystemHealthDashboard';

type ObservabilityTab = 'AUDIT' | 'SERVICES' | 'LOCAL_ERRORS' | 'USERS_HEALTH';

// Observability view — unifies what used to be split across:
//   - "Auditoría" (audit logs)
//   - "Telemetría de Servicios" (functions telemetry)
//   - "Diagnóstico del Sistema > Telemetría de Red" (user health)
// The module slot is still named DIAGNOSTICS in the router to preserve deep links.
export const SystemDiagnosticsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ObservabilityTab>('AUDIT');

  const tabs: Array<{
    id: ObservabilityTab;
    label: string;
    icon: typeof Activity;
    color: string;
  }> = [
    { id: 'AUDIT', label: 'Auditoría clínica', icon: ShieldCheck, color: 'text-emerald-400' },
    { id: 'SERVICES', label: 'Servicios externos', icon: Radar, color: 'text-indigo-400' },
    { id: 'LOCAL_ERRORS', label: 'Errores locales', icon: AlertTriangle, color: 'text-rose-400' },
    { id: 'USERS_HEALTH', label: 'Salud de usuarios', icon: BarChart3, color: 'text-sky-400' },
  ];

  return (
    <div className="animate-fade-in font-sans pb-16">
      <div className="bg-white border-b border-slate-200 px-6 py-3 shadow-sm sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 pr-4 border-r border-slate-200">
            <Activity size={16} className="text-slate-500" />
            <h1 className="text-sm font-bold text-slate-800">Observabilidad</h1>
          </div>

          <div className="flex gap-1 flex-wrap">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    'px-3 py-1.5 rounded-lg font-semibold text-xs transition-all flex items-center gap-1.5',
                    isActive
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  )}
                >
                  <Icon size={13} className={isActive ? '' : tab.color} />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        {activeTab === 'AUDIT' && <AuditView />}
        {activeTab === 'SERVICES' && <FunctionsTelemetryView />}
        {activeTab === 'LOCAL_ERRORS' && <LocalErrorLogsView />}
        {activeTab === 'USERS_HEALTH' && <SystemHealthDashboard />}
      </div>
    </div>
  );
};
