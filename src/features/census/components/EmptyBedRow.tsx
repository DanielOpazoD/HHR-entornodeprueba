import React from 'react';
import type { DragEvent } from 'react';
import { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import { LoaderCircle, Plus } from 'lucide-react';
import type { TableColumnConfig } from '@/context/TableConfigContext';

interface EmptyBedRowProps {
  bed: BedDefinition;
  columns: TableColumnConfig;
  visibleColumnCount: number;
  onClick: () => void;
  readOnly?: boolean;
  isPendingClear?: boolean;
  isDragOver?: boolean;
  onDragOver?: (e: DragEvent) => void;
  onDragEnter?: (e: DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: DragEvent) => void;
}

export const EmptyBedRow: React.FC<EmptyBedRowProps> = ({
  bed,
  columns,
  visibleColumnCount,
  onClick,
  readOnly = false,
  isPendingClear = false,
  isDragOver = false,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
}) => {
  const totalWidth = Object.values(columns).reduce((sum, width) => sum + width, 0);
  // "Tipo de cama" está oculto (rediseño 2026): la fila vacía ya no muestra la clasificación UTI/Media.
  const fixedColumnsWidth = columns.actions + columns.bed;
  const remainingWidth = totalWidth - fixedColumnsWidth;

  return (
    <tr
      className={`border-b border-slate-100/60 hover:bg-slate-50/50 transition-colors group h-7 ${
        isDragOver ? 'bg-medical-50 ring-2 ring-inset ring-medical-300 ring-dashed' : ''
      } ${isPendingClear ? 'bg-amber-50/60' : ''}`}
      aria-busy={isPendingClear}
      data-clear-pending={isPendingClear || undefined}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <td
        style={{ width: columns.actions }}
        className="py-0 px-1 border-r border-slate-100 print:hidden"
      />

      <td
        style={{ width: columns.bed }}
        className="py-0 px-1 border-r border-slate-100 text-center"
      >
        <span className="text-slate-400 font-medium text-xs">{bed.name}</span>
      </td>

      <td
        colSpan={Math.max(1, visibleColumnCount - 2)}
        style={{ width: remainingWidth }}
        className="py-0 pl-3"
      >
        {isPendingClear ? (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-700"
            role="status"
          >
            <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
            Confirmando limpieza…
          </span>
        ) : !readOnly ? (
          <button
            type="button"
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md opacity-0 group-hover:opacity-100 bg-slate-50 hover:bg-medical-100 border border-transparent group-hover:border-slate-200 text-slate-400 hover:text-medical-600 text-[11px] transition-all duration-200"
            onClick={onClick}
          >
            <Plus size={12} className="transition-transform group-hover:scale-110" />
            <span className="font-medium">Agregar paciente</span>
          </button>
        ) : null}
      </td>
    </tr>
  );
};
