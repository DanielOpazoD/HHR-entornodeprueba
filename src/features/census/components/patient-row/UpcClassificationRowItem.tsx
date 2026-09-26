import React from 'react';
import clsx from 'clsx';
import { CheckCheck } from 'lucide-react';
import type { UpcClassificationRow } from './upcClassificationWindowModel';

export const isAlreadySignedWithoutCriteria = (row: UpcClassificationRow): boolean =>
  row.pendingReason === null && row.classification === null;

const chipClass = (row: UpcClassificationRow): string => {
  if (row.pendingReason) return 'bg-slate-50 text-slate-600 ring-slate-200';
  if (row.classification === 'UPC_UCI') return 'bg-red-50 text-red-700 ring-red-200';
  if (row.classification === 'UPC_UTI') return 'bg-amber-50 text-amber-800 ring-amber-200';
  return 'bg-slate-50 text-slate-600 ring-slate-200';
};

/** Null when the chip would repeat the pending marker, which already shows with its icon. */
const chipLabel = (row: UpcClassificationRow): string | null => {
  if (row.classification === 'UPC_UCI') return 'UPC-UCI';
  if (row.classification === 'UPC_UTI') return 'UPC-UTI';
  return row.pendingReason ? null : 'Sin criterios';
};

interface UpcClassificationRowItemProps {
  row: UpcClassificationRow;
  isSelected: boolean;
  isMarked: boolean;
  readOnly: boolean;
  onToggleMark: (rowKey: string, nextMarked: boolean) => void;
  onSelect: (rowKey: string) => void;
}

/** One occupied classifiable bed inside the day window, with its quick "sin criterios" mark. */
export const UpcClassificationRowItem: React.FC<UpcClassificationRowItemProps> = ({
  row,
  isSelected,
  isMarked,
  readOnly,
  onToggleMark,
  onSelect,
}) => {
  const alreadySigned = isAlreadySignedWithoutCriteria(row);

  return (
    <li
      className={clsx(
        'flex flex-col gap-1 border-b border-slate-100 px-3 py-2',
        isSelected && 'bg-medical-50/60'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-bold text-slate-800">{row.bedName}</span>
        {chipLabel(row) && (
          <span
            className={clsx(
              'rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1',
              chipClass(row)
            )}
          >
            {chipLabel(row)}
          </span>
        )}
        {row.pendingReason && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">
            Pendiente
          </span>
        )}
      </div>
      <span className="truncate text-xs text-slate-600">
        {row.patientName}
        {row.rut ? ` · ${row.rut}` : ''}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={isMarked}
          disabled={readOnly || alreadySigned}
          title={
            alreadySigned
              ? 'Esta cama ya tiene la evaluación del día sin criterios'
              : 'Marcar sin criterios UPC para confirmar al final'
          }
          onClick={() => onToggleMark(row.key, !isMarked)}
          className={clsx(
            'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed',
            isMarked
              ? 'border-emerald-500 bg-emerald-600 text-white'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
            alreadySigned && 'border-slate-200 bg-slate-50 text-slate-400'
          )}
        >
          <CheckCheck size={11} aria-hidden="true" />
          {alreadySigned
            ? 'Sin criterios confirmado'
            : isMarked
              ? 'Sin criterios UPC ✓'
              : 'Sin criterios UPC'}
        </button>
        <button
          type="button"
          disabled={readOnly}
          onClick={() => onSelect(row.key)}
          className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
        >
          Ver detalle
        </button>
      </div>
    </li>
  );
};
