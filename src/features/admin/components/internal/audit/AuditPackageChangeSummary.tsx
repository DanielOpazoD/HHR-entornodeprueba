import type React from 'react';

import type { ClinicalAuditPackageChange } from '@/services/admin/clinicalAuditPatientPackages';
import {
  formatAuditPackageValue,
  formatAuditPackageValuePreview,
  isVerboseAuditPackageValue,
} from './patientAuditPackageRowUtils';

interface AuditPackageVisibleChangesProps {
  changes: ClinicalAuditPackageChange[];
  hiddenChangeCount: number;
  integratedChangeCount: number;
  totalChangeCount: number;
}

interface AuditPackageExpandedChangesProps {
  changes: ClinicalAuditPackageChange[];
  summary: string;
}

const normalizeInlineAuditValue = (value: unknown): string =>
  formatAuditPackageValue(value).replace(/\s+/g, ' ').trim();

const trimDeltaPrefix = (value: string): string => value.replace(/^[\s.,;:>/-]+/, '').trim();

const buildVerboseChangeSummary = (
  change: ClinicalAuditPackageChange
): { label: string; value: string; tone: 'positive' | 'negative' | 'neutral' } => {
  const oldText = normalizeInlineAuditValue(change.oldValue);
  const newText = normalizeInlineAuditValue(change.newValue);

  if (oldText !== '-' && newText.startsWith(oldText) && newText.length > oldText.length) {
    return {
      label: 'Agregado',
      value: formatAuditPackageValuePreview(trimDeltaPrefix(newText.slice(oldText.length))),
      tone: 'positive',
    };
  }

  if (newText !== '-' && oldText.startsWith(newText) && oldText.length > newText.length) {
    return {
      label: 'Retirado',
      value: formatAuditPackageValuePreview(trimDeltaPrefix(oldText.slice(newText.length))),
      tone: 'negative',
    };
  }

  return {
    label: oldText === '-' ? 'Registrado' : 'Actualizado',
    value: formatAuditPackageValuePreview(change.newValue),
    tone: 'neutral',
  };
};

const InlineChangeValue: React.FC<{ change: ClinicalAuditPackageChange }> = ({ change }) => {
  const isVerbose =
    isVerboseAuditPackageValue(change.oldValue) || isVerboseAuditPackageValue(change.newValue);

  if (isVerbose) {
    const summary = buildVerboseChangeSummary(change);
    const valueColor =
      summary.tone === 'positive'
        ? 'text-emerald-700'
        : summary.tone === 'negative'
          ? 'text-rose-700'
          : 'text-slate-700';

    return (
      <p
        className="text-[11px] leading-tight text-slate-500"
        title={`Antes: ${formatAuditPackageValue(change.oldValue)}\nDespues: ${formatAuditPackageValue(
          change.newValue
        )}`}
      >
        <span className="font-semibold text-slate-600">{summary.label}:</span>
        <span className={`ml-1 break-words font-bold ${valueColor}`}>{summary.value}</span>
      </p>
    );
  }

  return (
    <p className="text-[11px] leading-tight text-slate-500">
      <span className="break-words text-rose-700" title={formatAuditPackageValue(change.oldValue)}>
        {formatAuditPackageValuePreview(change.oldValue)}
      </span>
      <span className="px-1 text-slate-300">-&gt;</span>
      <span
        className="break-words font-bold text-emerald-700"
        title={formatAuditPackageValue(change.newValue)}
      >
        {formatAuditPackageValuePreview(change.newValue)}
      </span>
    </p>
  );
};

export const AuditPackageVisibleChanges: React.FC<AuditPackageVisibleChangesProps> = ({
  changes,
  hiddenChangeCount,
  integratedChangeCount,
  totalChangeCount,
}) => (
  <div className="flex flex-wrap gap-1.5">
    {changes.map(change => (
      <div
        key={`${change.sourceLogId}-${change.fieldLabel}`}
        className="min-w-[120px] max-w-[420px] rounded-lg border border-slate-200 bg-white px-2 py-1 shadow-sm"
      >
        <p className="text-[10px] font-black uppercase text-slate-500">{change.fieldLabel}</p>
        <InlineChangeValue change={change} />
      </div>
    ))}
    {hiddenChangeCount > 0 && (
      <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-500">
        +{hiddenChangeCount} cambios
      </span>
    )}
    {integratedChangeCount > 0 && (
      <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
        {totalChangeCount} cambios integrados
      </span>
    )}
  </div>
);

export const AuditPackageExpandedChanges: React.FC<AuditPackageExpandedChangesProps> = ({
  changes,
  summary,
}) => (
  <div className="grid gap-2 p-3 md:grid-cols-2">
    {changes.length > 0 ? (
      changes.map(change => (
        <div
          key={`${change.sourceLogId}-${change.fieldLabel}-expanded`}
          className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2"
        >
          <p className="text-[10px] font-black uppercase text-slate-500">{change.fieldLabel}</p>
          <p className="mt-1 text-xs leading-tight text-slate-600">
            <span className="text-rose-700">{formatAuditPackageValue(change.oldValue)}</span>
            <span className="px-1 text-slate-300">-&gt;</span>
            <span className="font-bold text-emerald-700">
              {formatAuditPackageValue(change.newValue)}
            </span>
          </p>
        </div>
      ))
    ) : (
      <p className="text-xs font-medium text-slate-700">{summary}</p>
    )}
  </div>
);
