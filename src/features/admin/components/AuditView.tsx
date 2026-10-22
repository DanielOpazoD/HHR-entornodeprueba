import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useAuditContext } from '@/context/AuditContext';
import type { AuditTrailCategory } from '@/types/auditTrailTypes';
import {
  canAccessAuditSensitivePanels,
  canAccessAuditView,
  canExportAuditData,
} from '@/services/admin/auditAccessPolicy';
import { useAuditTrail, AUDIT_TRAIL_FETCH_LIMIT } from '@/features/admin/hooks/useAuditTrail';
import { AccessRestricted } from './internal/AccessRestricted';
import { AuditTrailHeader } from './internal/audit/AuditTrailHeader';
import { AuditTrailSummaryBar } from './internal/audit/AuditTrailSummaryBar';
import { AuditTrailToolbar } from './internal/audit/AuditTrailToolbar';
import { AuditTrailGroupList } from './internal/audit/AuditTrailGroupList';
import { AuditTrailSessionTimeline } from './internal/audit/AuditTrailSessionTimeline';
import { ExportKeysPanel } from './internal/audit/ExportKeysPanel';
import { useAuditTrailExport } from './hooks/useAuditTrailExport';

const Notice: React.FC<{ tone: 'info' | 'error'; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <p
    role={tone === 'error' ? 'alert' : 'status'}
    className={
      tone === 'error'
        ? 'flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800'
        : 'flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600'
    }
  >
    {tone === 'error' && <AlertCircle size={14} />}
    {children}
  </p>
);

/**
 * Clinical audit trail (Ley 20.584): who did what, to which patient, when and from where.
 * Grouped by patient, staff member, connection or time; everything technical stays one click
 * behind each statement.
 */
export const AuditView: React.FC = () => {
  const { role } = useAuth();
  const { logEvent } = useAuditContext();
  const trail = useAuditTrail();
  const [exportKeysOpen, setExportKeysOpen] = React.useState(false);

  const onExported = React.useCallback(
    (detail: { startDate: string; endDate: string; eventCount: number }) =>
      logEvent('DATA_EXPORTED', 'system', 'auditoria', { scope: 'audit_trail', ...detail }),
    [logEvent]
  );
  const { isExporting, exportExcel } = useAuditTrailExport({
    events: trail.visibleEvents,
    sessions: trail.sessions,
    period: trail.period,
    onExported,
  });

  if (!canAccessAuditView(role)) {
    return <AccessRestricted />;
  }

  const { preferences, scope, period } = trail;
  const multiDay = period.startDate !== period.endDate;
  const toggleCategory = (category: AuditTrailCategory) =>
    trail.updatePreferences({
      categories: preferences.categories.includes(category)
        ? preferences.categories.filter(item => item !== category)
        : [...preferences.categories, category],
    });

  return (
    <div className="mx-auto max-w-[1400px] space-y-3 px-4 py-4 font-sans">
      <AuditTrailHeader
        period={period}
        onPeriodChange={trail.setPeriod}
        loading={trail.status === 'loading'}
        onRefresh={trail.refresh}
        onExport={canExportAuditData(role) ? () => void exportExcel() : undefined}
        exporting={isExporting}
        exportDisabled={trail.status !== 'ready' || trail.visibleEvents.length === 0}
        onToggleExportKeys={
          canAccessAuditSensitivePanels(role) ? () => setExportKeysOpen(open => !open) : undefined
        }
        exportKeysOpen={exportKeysOpen}
      />

      {exportKeysOpen && <ExportKeysPanel />}

      <AuditTrailSummaryBar
        summary={trail.summary}
        categories={preferences.categories}
        onToggleCategory={toggleCategory}
        reviewOnly={scope.reviewOnly}
        onToggleReview={() => trail.updateScope({ reviewOnly: !scope.reviewOnly })}
      />

      <AuditTrailToolbar
        scope={scope}
        onScopeChange={trail.updateScope}
        actorOptions={trail.actorOptions}
        preferences={preferences}
        onPreferencesChange={trail.updatePreferences}
      />

      {trail.status === 'error' && (
        <Notice tone="error">No se pudo cargar la auditoría: {trail.errorMessage}</Notice>
      )}
      {trail.truncated && (
        <Notice tone="info">
          Se muestran los {AUDIT_TRAIL_FETCH_LIMIT.toLocaleString('es-CL')} eventos más recientes
          del período. Acota las fechas para ver el resto.
        </Notice>
      )}

      {trail.status === 'loading' ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-12 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          Cargando auditoría…
        </div>
      ) : (
        <>
          {preferences.grouping === 'session' && !multiDay && (
            <AuditTrailSessionTimeline sessions={trail.sessions} day={period.endDate} />
          )}
          {trail.groups.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white py-12 text-center text-sm text-slate-500">
              Sin actividad para este período y filtros.
            </div>
          ) : (
            <AuditTrailGroupList
              groups={trail.groups}
              preferences={preferences}
              multiDay={multiDay}
              onSelectActor={actorKey => trail.updateScope({ actorKey })}
              onSelectPatient={name => trail.updateScope({ search: name })}
            />
          )}
        </>
      )}
    </div>
  );
};
