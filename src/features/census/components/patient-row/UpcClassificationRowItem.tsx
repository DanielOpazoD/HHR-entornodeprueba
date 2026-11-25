import React, { useId } from 'react';
import clsx from 'clsx';
import { Check, Clock3, Pencil } from 'lucide-react';
import {
  resolveUpcClassification,
  resolveUpcClassificationLabel,
} from '@/domain/upc/upcClassification';
import { readClinicalTimestamp } from '@/utils/dateDisplayUtils';
import type { UpcClassificationRow, UpcRowDraft } from './upcClassificationWindowModel';

interface UpcClassificationRowItemProps {
  row: UpcClassificationRow;
  draft?: UpcRowDraft;
  isSelected: boolean;
  canEdit: boolean;
  saving: boolean;
  onToggleMark: () => void;
  onSelect: (key: string) => void;
}

export const UpcClassificationRowItem: React.FC<UpcClassificationRowItemProps> = ({
  row,
  draft,
  isSelected,
  canEdit,
  saving,
  onToggleMark,
  onSelect,
}) => {
  const statusId = useId();
  const isPending = Boolean(row.pendingReason);
  const marked = draft?.noCriteria === true;
  const draftLevel =
    draft && !marked
      ? resolveUpcClassificationLabel(
          resolveUpcClassification({ uciCriteria: draft.uci, utiCriteria: draft.uti })
        )
      : '';
  const time =
    !isPending && !draft && row.evaluatedAt ? readClinicalTimestamp(row.evaluatedAt)?.hhmm : null;
  const Icon = draft ? Pencil : isPending ? Clock3 : Check;
  const status = draft
    ? `Borrador · ${draftLevel || 'Sin criterios'}`
    : isPending
      ? ['Pendiente', row.classificationLabel].filter(Boolean).join(' · ')
      : row.classificationLabel || 'Sin criterios';
  const showQuickMark = canEdit && (isPending || Boolean(row.classification));
  return (
    <li
      className={clsx(
        'flex items-center gap-2 border-b border-slate-100 px-3 py-1.5',
        isSelected && 'bg-teal-50/70'
      )}
    >
      <button
        type="button"
        aria-current={isSelected ? 'true' : undefined}
        aria-labelledby={`${statusId}-name`}
        aria-describedby={statusId}
        disabled={saving}
        onClick={() => onSelect(row.key)}
        className="min-w-0 flex-1 rounded py-1 text-left focus-visible:outline-teal-600"
      >
        <span id={`${statusId}-name`} className="block text-xs leading-snug text-slate-800">
          <strong>{row.bedName}</strong>
          <span aria-hidden="true"> · </span>
          <span className="font-medium">{row.patientName}</span>
        </span>
        <span
          id={statusId}
          className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] leading-tight"
        >
          <span
            title={draft ? undefined : (row.pendingReason ?? undefined)}
            className={clsx(
              'inline-flex items-center gap-1 font-medium',
              draft ? 'text-slate-700' : isPending ? 'text-amber-800' : 'text-teal-800'
            )}
          >
            <Icon size={12} aria-hidden="true" />
            {!draft && !isPending && <span className="sr-only">Confirmada</span>}
            {status}
            {time && <time dateTime={row.evaluatedAt}>· {time}</time>}
          </span>
          {row.rut && <span className="text-slate-500">{row.rut}</span>}
        </span>
      </button>
      {showQuickMark && (
        <button
          type="button"
          aria-pressed={marked}
          aria-label={`${marked ? 'Deshacer marca' : 'Marcar'} sin criterios UPC en ${row.bedName}`}
          disabled={saving}
          onClick={onToggleMark}
          className="min-h-7 shrink-0 rounded px-1.5 text-[11px] font-semibold text-teal-800 hover:bg-teal-100 focus-visible:outline-teal-600 disabled:opacity-50"
        >
          {marked ? 'Deshacer' : 'Sin criterios'}
        </button>
      )}
    </li>
  );
};
