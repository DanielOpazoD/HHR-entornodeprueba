import React from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Download, KeyRound, RefreshCw } from 'lucide-react';
import {
  AUDIT_TRAIL_PERIOD_LABELS,
  buildAuditTrailPeriod,
  buildAuditTrailRange,
  formatAuditTrailPeriod,
  shiftAuditTrailPeriod,
  type AuditTrailPeriod,
  type AuditTrailPeriodKind,
} from '@/services/admin/auditTrail/auditTrailPeriod';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { FOCUS_RING } from './auditTrailDisplay';

interface AuditTrailHeaderProps {
  period: AuditTrailPeriod;
  onPeriodChange: (period: AuditTrailPeriod) => void;
  loading: boolean;
  onRefresh: () => void;
  onExport?: () => void;
  exporting: boolean;
  /** Nothing to export yet (loading or an empty view). */
  exportDisabled?: boolean;
  onToggleExportKeys?: () => void;
  exportKeysOpen: boolean;
}

const PERIOD_KINDS: AuditTrailPeriodKind[] = ['day', 'week', 'month', 'range'];

const iconButton = clsx(
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50',
  FOCUS_RING
);

export const AuditTrailHeader: React.FC<AuditTrailHeaderProps> = ({
  period,
  onPeriodChange,
  loading,
  onRefresh,
  onExport,
  exporting,
  exportDisabled = false,
  onToggleExportKeys,
  exportKeysOpen,
}) => {
  const today = getClinicalCalendarDateISO();

  const selectKind = (kind: AuditTrailPeriodKind) => {
    if (kind === 'range') {
      onPeriodChange(buildAuditTrailRange(period.startDate, period.endDate));
      return;
    }
    onPeriodChange(buildAuditTrailPeriod(kind, period.endDate));
  };

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">Auditoría</h2>
        <p className="text-xs text-slate-500">Accesos y cambios · hora de Rapa Nui</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
          role="group"
          aria-label="Período"
        >
          {PERIOD_KINDS.map(kind => (
            <button
              key={kind}
              type="button"
              aria-pressed={period.kind === kind}
              onClick={() => selectKind(kind)}
              className={clsx(
                'rounded-md px-2.5 py-1 text-xs font-medium transition',
                FOCUS_RING,
                period.kind === kind
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              )}
            >
              {AUDIT_TRAIL_PERIOD_LABELS[kind]}
            </button>
          ))}
        </div>

        {period.kind === 'range' ? (
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <input
              type="date"
              aria-label="Desde"
              value={period.startDate}
              max={today}
              onChange={event =>
                event.target.value &&
                onPeriodChange(buildAuditTrailRange(event.target.value, period.endDate))
              }
              className={clsx('h-8 rounded-lg border border-slate-200 px-2 text-xs', FOCUS_RING)}
            />
            <span aria-hidden>–</span>
            <input
              type="date"
              aria-label="Hasta"
              value={period.endDate}
              max={today}
              onChange={event =>
                event.target.value &&
                onPeriodChange(buildAuditTrailRange(period.startDate, event.target.value))
              }
              className={clsx('h-8 rounded-lg border border-slate-200 px-2 text-xs', FOCUS_RING)}
            />
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Período anterior"
              onClick={() => onPeriodChange(shiftAuditTrailPeriod(period, -1))}
              className={clsx(iconButton, 'w-8 justify-center px-0')}
            >
              <ChevronLeft size={15} />
            </button>
            <span className="min-w-[96px] text-center text-sm font-medium tabular-nums text-slate-800">
              {formatAuditTrailPeriod(period)}
            </span>
            <button
              type="button"
              aria-label="Período siguiente"
              disabled={period.endDate >= today}
              onClick={() => onPeriodChange(shiftAuditTrailPeriod(period, 1))}
              className={clsx(iconButton, 'w-8 justify-center px-0')}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}

        {onExport && (
          <button
            type="button"
            onClick={onExport}
            disabled={exporting || exportDisabled}
            className={iconButton}
          >
            <Download size={14} />
            {exporting ? 'Exportando…' : 'Exportar'}
          </button>
        )}
        {onToggleExportKeys && (
          <button
            type="button"
            aria-pressed={exportKeysOpen}
            onClick={onToggleExportKeys}
            className={clsx(iconButton, exportKeysOpen && 'border-sky-200 bg-sky-50 text-sky-700')}
          >
            <KeyRound size={14} />
            Claves Excel
          </button>
        )}
        <button
          type="button"
          aria-label="Actualizar"
          onClick={onRefresh}
          className={clsx(iconButton, 'w-8 justify-center px-0')}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} />
        </button>
      </div>
    </header>
  );
};
