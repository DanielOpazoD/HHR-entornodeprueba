import React, { useState } from 'react';
import clsx from 'clsx';
import { History, ShieldCheck, X } from 'lucide-react';
import { UPC_UCI_CRITERIA, UPC_UTI_CRITERIA } from '@/domain/upc/upcCriteria';
import {
  resolveUpcClassificationLabel,
  resolveUpcBadgeColor,
} from '@/domain/upc/upcClassification';
import type { UpcClassification } from '@/domain/upc/upcClassification';
import { UPC_CHECKLIST_PANEL_WIDTH } from '@/features/census/controllers/upcChecklistPopoverController';

interface UpcChecklistPanelProps {
  draftUci: ReadonlySet<string>;
  draftUti: ReadonlySet<string>;
  draftClassification: UpcClassification;
  hasDraftCriteria: boolean;
  /** Whether UCI criteria can be selected (false for Neo1/Neo2 per protocol §3). */
  uciAllowed: boolean;
  onToggleUci: (id: string) => void;
  onToggleUti: (id: string) => void;
  onClose: () => void;
  saving?: boolean;
  bedId?: string;
  evaluationControls?: React.ReactNode;
  historyContent?: React.ReactNode;
  readOnly?: boolean;
}

const CriterionCheckbox: React.FC<{
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (id: string) => void;
  accent?: 'red' | 'amber';
}> = ({ id, label, checked, disabled = false, onToggle, accent = 'amber' }) => (
  <label
    className={clsx(
      'flex min-h-7 items-start gap-2 rounded-md px-2 py-1 transition-colors text-[11px] leading-snug',
      disabled
        ? 'opacity-40 cursor-not-allowed'
        : checked
          ? accent === 'red'
            ? 'bg-red-50 text-red-800 cursor-pointer'
            : 'bg-amber-50 text-amber-800 cursor-pointer'
          : 'text-slate-600 hover:bg-slate-50 cursor-pointer'
    )}
    aria-label={label}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={() => onToggle(id)}
      className={clsx(
        'mt-0.5 w-3.5 h-3.5 rounded shrink-0',
        accent === 'red' ? 'text-red-600' : 'text-amber-600'
      )}
      aria-label={label}
    />
    <span>{label}</span>
  </label>
);

export const UpcChecklistPanel: React.FC<UpcChecklistPanelProps> = ({
  draftUci,
  draftUti,
  draftClassification,
  hasDraftCriteria,
  uciAllowed,
  onToggleUci,
  onToggleUti,
  onClose,
  saving = false,
  bedId,
  evaluationControls,
  historyContent,
  readOnly = false,
}) => {
  const [selectedView, setView] = useState<'evaluation' | 'history'>('evaluation');
  const view = readOnly ? 'history' : selectedView;
  const badgeColors = resolveUpcBadgeColor(draftClassification);
  const classLabel = resolveUpcClassificationLabel(draftClassification);

  return (
    <div
      className="flex max-h-[inherit] max-w-[calc(100vw-16px)] flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
      style={{ width: UPC_CHECKLIST_PANEL_WIDTH }}
      role="dialog"
      aria-label="Checklist de clasificación UPC"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-3 py-1.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} className="text-slate-500" />
          <span className="text-[12px] font-bold text-slate-700 tracking-tight">
            Clasificación UPC
            {bedId && <span className="ml-1 font-normal text-slate-500">· {bedId}</span>}
          </span>
          {view === 'evaluation' && hasDraftCriteria && (
            <span className="text-[10px] text-slate-500">
              Selección: {draftUci.size + draftUti.size} criterio
              {draftUci.size + draftUti.size === 1 ? '' : 's'}
            </span>
          )}
          {view === 'evaluation' && (
            <span
              aria-live="polite"
              className={clsx(
                'px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors',
                draftClassification
                  ? clsx(badgeColors.text, badgeColors.bg, badgeColors.border)
                  : 'text-slate-400 bg-transparent border-transparent'
              )}
            >
              {classLabel || 'No UPC'}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Cerrar checklist UPC"
          className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {historyContent && (
        <nav
          aria-label="Vistas UPC"
          className="flex shrink-0 gap-1 border-b border-slate-100 px-3 py-1 text-[11px]"
        >
          {!readOnly && (
            <button
              type="button"
              aria-pressed={view === 'evaluation'}
              onClick={() => setView('evaluation')}
              className={clsx(
                'rounded px-2 py-1 font-semibold focus-visible:ring-2 focus-visible:ring-emerald-600',
                view === 'evaluation'
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'text-slate-600 hover:bg-slate-50'
              )}
            >
              Evaluar
            </button>
          )}
          <button
            type="button"
            aria-pressed={view === 'history'}
            disabled={saving}
            onClick={() => setView('history')}
            className={clsx(
              'inline-flex items-center gap-1 rounded px-2 py-1 font-semibold focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50',
              view === 'history'
                ? 'bg-emerald-50 text-emerald-800'
                : 'text-slate-600 hover:bg-slate-50'
            )}
          >
            <History size={12} />
            Historial
          </button>
        </nav>
      )}

      {view === 'history' ? (
        historyContent
      ) : (
        <>
          {/* Full content at normal sizes; scrolling is only a fallback for very short viewports. */}
          <div className="min-h-0 overflow-y-auto px-3 py-1.5 space-y-1.5">
            {/* UCI section */}
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <div
                  className={clsx(
                    'w-1.5 h-1.5 rounded-full',
                    uciAllowed ? 'bg-red-500' : 'bg-slate-300'
                  )}
                />
                <span
                  className={clsx(
                    'text-[10px] font-bold uppercase tracking-wider',
                    uciAllowed ? 'text-red-700' : 'text-slate-400'
                  )}
                >
                  UCI — Soporte vital avanzado
                </span>
                {!uciAllowed && (
                  <span className="text-[9px] text-slate-400 font-normal normal-case">
                    (no disponible en Neo)
                  </span>
                )}
              </div>
              <div
                className={clsx(
                  'rounded-lg border p-0.5',
                  uciAllowed ? 'border-red-100' : 'border-slate-100'
                )}
              >
                {UPC_UCI_CRITERIA.map(c => (
                  <CriterionCheckbox
                    key={c.id}
                    id={c.id}
                    label={c.label}
                    checked={draftUci.has(c.id)}
                    disabled={!uciAllowed || saving}
                    onToggle={onToggleUci}
                    accent="red"
                  />
                ))}
              </div>
            </div>

            {/* UTI section */}
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">
                  UTI — Monitorización y soporte no invasivo
                </span>
              </div>
              <div className="rounded-lg border border-amber-100 p-0.5">
                {UPC_UTI_CRITERIA.map(c => (
                  <CriterionCheckbox
                    key={c.id}
                    id={c.id}
                    label={c.label}
                    checked={draftUti.has(c.id)}
                    disabled={saving}
                    onToggle={onToggleUti}
                    accent="amber"
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 px-3 py-1.5 border-t border-slate-100 bg-slate-50/50 rounded-b-xl">
            {evaluationControls}
          </div>
        </>
      )}
    </div>
  );
};
