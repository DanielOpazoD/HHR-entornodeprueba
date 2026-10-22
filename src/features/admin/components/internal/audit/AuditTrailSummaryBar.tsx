import React from 'react';
import clsx from 'clsx';
import { AlertTriangle } from 'lucide-react';
import type { AuditTrailCategory } from '@/types/auditTrailTypes';
import {
  AUDIT_TRAIL_CATEGORY_LABELS,
  AUDIT_TRAIL_CATEGORY_ORDER,
} from '@/services/admin/auditTrail/auditTrailCatalog';
import type { AuditTrailSummary } from '@/services/admin/auditTrail/auditTrailFilters';
import { FOCUS_RING, pluralize } from './auditTrailDisplay';

const CATEGORY_DOTS: Record<AuditTrailCategory, string> = {
  change: 'bg-sky-500',
  access: 'bg-violet-400',
  connection: 'bg-emerald-500',
  system: 'bg-slate-400',
};

interface AuditTrailSummaryBarProps {
  summary: AuditTrailSummary;
  categories: AuditTrailCategory[];
  onToggleCategory: (category: AuditTrailCategory) => void;
  reviewOnly: boolean;
  onToggleReview: () => void;
}

/** Totals of the period that double as the category switches of the list. */
export const AuditTrailSummaryBar: React.FC<AuditTrailSummaryBarProps> = ({
  summary,
  categories,
  onToggleCategory,
  reviewOnly,
  onToggleReview,
}) => (
  <div
    className="flex flex-wrap items-center gap-x-4 gap-y-2"
    role="group"
    aria-label="Resumen del período"
  >
    <div className="flex flex-wrap items-center gap-1.5">
      {AUDIT_TRAIL_CATEGORY_ORDER.map(category => {
        const active = categories.includes(category);
        return (
          <button
            key={category}
            type="button"
            aria-pressed={active}
            onClick={() => onToggleCategory(category)}
            className={clsx(
              'inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs transition',
              FOCUS_RING,
              active
                ? 'border-slate-300 bg-white text-slate-800 shadow-sm'
                : 'border-transparent bg-slate-100/70 text-slate-400 hover:text-slate-600'
            )}
          >
            <span
              className={clsx(
                'h-2 w-2 rounded-full',
                active ? CATEGORY_DOTS[category] : 'bg-slate-300'
              )}
            />
            {AUDIT_TRAIL_CATEGORY_LABELS[category]}
            <span className="font-semibold tabular-nums">
              {/* Connections are counted as sessions; older records without one, as events. */}
              {category === 'connection' && summary.sessions > 0
                ? summary.sessions
                : summary[category]}
            </span>
          </button>
        );
      })}
    </div>

    <p className="text-xs text-slate-500">
      {pluralize(summary.patients, 'paciente', 'pacientes')} ·{' '}
      {pluralize(summary.actors, 'funcionario', 'funcionarios')}
    </p>

    {(summary.review > 0 || reviewOnly) && (
      <button
        type="button"
        aria-pressed={reviewOnly}
        onClick={onToggleReview}
        className={clsx(
          'ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition',
          FOCUS_RING,
          reviewOnly
            ? 'border-amber-300 bg-amber-100 text-amber-900'
            : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
        )}
      >
        <AlertTriangle size={13} />
        Revisar <span className="tabular-nums">{summary.review}</span>
      </button>
    )}
  </div>
);
