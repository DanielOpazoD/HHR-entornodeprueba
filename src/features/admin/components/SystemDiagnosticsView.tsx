import React from 'react';
import { Activity, AlertTriangle, BarChart3, Radar, ShieldCheck } from 'lucide-react';
import { AdminTabsShell } from './internal/AdminTabsShell';
import { AuditView } from './AuditView';
import { FunctionsTelemetryView } from './FunctionsTelemetryView';
import { LocalErrorLogsView } from './LocalErrorLogsView';
import { SystemHealthDashboard } from './SystemHealthDashboard';

// Observability view — unifies what used to be split across:
//   - "Auditoría" (audit logs)
//   - "Telemetría de Servicios" (functions telemetry)
//   - "Diagnóstico del Sistema > Telemetría de Red" (user health)
// The module slot is still named DIAGNOSTICS in the router to preserve deep links.
export const SystemDiagnosticsView: React.FC = () => (
  <AdminTabsShell
    title="Observabilidad"
    icon={Activity}
    tabs={[
      {
        id: 'AUDIT',
        label: 'Auditoría clínica',
        icon: ShieldCheck,
        color: 'text-emerald-400',
        content: <AuditView />,
      },
      {
        id: 'SERVICES',
        label: 'Servicios externos',
        icon: Radar,
        color: 'text-indigo-400',
        content: <FunctionsTelemetryView />,
      },
      {
        id: 'LOCAL_ERRORS',
        label: 'Errores locales',
        icon: AlertTriangle,
        color: 'text-rose-400',
        content: <LocalErrorLogsView />,
      },
      {
        id: 'USERS_HEALTH',
        label: 'Salud de usuarios',
        icon: BarChart3,
        color: 'text-sky-400',
        content: <SystemHealthDashboard />,
      },
    ]}
  />
);
