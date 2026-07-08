import React from 'react';
import { Bed, Check, Loader2, Minus } from 'lucide-react';
import {
  PRESCRIPTION_TYPES,
  type PrescriptionRecord,
  type PrescriptionType,
} from '@/types/prescriptionTypes';
import { PrescriptionThumbnail } from '@/features/prescriptions/components/PrescriptionThumbnail';
import { PrescriptionQuickTypeButton } from '@/features/prescriptions/components/PrescriptionQuickTypeButton';

export interface PrescriptionBedRowData {
  bedId: string;
  patientName: string;
  patientRut: string;
  isDischargeSnapshot?: boolean;
  byType: Record<PrescriptionType, PrescriptionRecord[]>;
}

interface PrescriptionBedRowProps {
  row: PrescriptionBedRowData;
  draggingRecord: PrescriptionRecord | null;
  hoverCell: { bedId: string; type: PrescriptionType } | null;
  pickerSource: PrescriptionRecord | null;
  pendingAssignId: string | null;
  onDragOver: (
    event: React.DragEvent<HTMLTableCellElement>,
    type: PrescriptionType,
    bedId: string
  ) => void;
  onDragLeave: (type: PrescriptionType, bedId: string) => void;
  onDrop: (
    event: React.DragEvent<HTMLTableCellElement>,
    row: PrescriptionBedRowData,
    type: PrescriptionType
  ) => Promise<void> | void;
  onPickerAssign: (record: PrescriptionRecord, row: PrescriptionBedRowData) => Promise<void> | void;
  onPreviewImage: (record: PrescriptionRecord, url: string) => void;
  onUpdateType?: (record: PrescriptionRecord, nextType: PrescriptionType) => Promise<void>;
  onReassignRecord?: (record: PrescriptionRecord) => void;
  enableDrop: boolean;
}

export const PrescriptionBedRow: React.FC<PrescriptionBedRowProps> = ({
  row,
  draggingRecord,
  hoverCell,
  pickerSource,
  pendingAssignId,
  onDragOver,
  onDragLeave,
  onDrop,
  onPickerAssign,
  onPreviewImage,
  onUpdateType,
  onReassignRecord,
  enableDrop,
}) => {
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-2 py-2 font-mono text-xs font-semibold text-slate-700">{row.bedId}</td>
      <td className="px-2 py-2 text-xs text-slate-700">
        <p className="truncate font-medium">{row.patientName || 'Sin nombre'}</p>
        {row.patientRut && <p className="text-[10px] text-slate-400">{row.patientRut}</p>}
        {row.isDischargeSnapshot && (
          <p className="mt-1 inline-flex rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-800">
            Egreso
          </p>
        )}
      </td>
      {PRESCRIPTION_TYPES.map(type => {
        const cell = row.byType[type];
        const has = cell.length > 0;
        const dragMatch = !!draggingRecord && draggingRecord.prescriptionType === type;
        const dragMismatch = !!draggingRecord && draggingRecord.prescriptionType !== type;
        const isHovering = hoverCell?.bedId === row.bedId && hoverCell.type === type;
        const isPickerTarget = !!pickerSource && pickerSource.prescriptionType === type;
        return (
          <td
            key={type}
            data-testid={`prescription-bed-cell-${row.bedId}-${type}`}
            onDragOver={enableDrop ? event => onDragOver(event, type, row.bedId) : undefined}
            onDragLeave={enableDrop ? () => onDragLeave(type, row.bedId) : undefined}
            onDrop={enableDrop ? event => onDrop(event, row, type) : undefined}
            className={`px-2 py-2 transition-colors ${
              isHovering
                ? 'bg-emerald-50 ring-2 ring-emerald-300'
                : dragMatch
                  ? 'bg-emerald-50/40'
                  : dragMismatch
                    ? 'opacity-50'
                    : ''
            }`}
          >
            <div className="flex flex-col items-center gap-1">
              <span
                aria-label={has ? `${cell.length} receta(s) ${type}` : `Sin receta ${type}`}
                className={
                  has
                    ? 'inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700'
                    : 'inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-400'
                }
              >
                {has ? <Check size={14} /> : <Minus size={14} />}
              </span>
              {has && (
                <div className="flex flex-wrap justify-center gap-1">
                  {cell.map(record => (
                    <div key={record.id} className="flex flex-col items-center gap-0.5">
                      <PrescriptionThumbnail
                        thumbnailStoragePath={record.image.thumbnailStoragePath}
                        fullStoragePath={record.image.storagePath}
                        alt={`${type} · ${row.bedId}`}
                        onPreview={url => onPreviewImage(record, url)}
                      />
                      {onUpdateType && (
                        <PrescriptionQuickTypeButton
                          currentType={record.prescriptionType}
                          onChange={nextType => onUpdateType(record, nextType)}
                          variant="inline"
                        />
                      )}
                      {onReassignRecord && (
                        <button
                          type="button"
                          onClick={() => onReassignRecord(record)}
                          aria-label={`Cambiar cama de receta ${row.bedId}`}
                          title="Cambiar cama"
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 shadow-sm hover:border-sky-300 hover:text-sky-700"
                        >
                          <Bed size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {isPickerTarget && pickerSource && (
                <button
                  type="button"
                  data-testid={`prescription-assign-here-${row.bedId}-${type}`}
                  disabled={pendingAssignId === pickerSource.id}
                  onClick={() => onPickerAssign(pickerSource, row)}
                  className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pendingAssignId === pickerSource.id ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    'Asignar aquí'
                  )}
                </button>
              )}
            </div>
          </td>
        );
      })}
    </tr>
  );
};
