import React from 'react';
import { Inbox, Loader2, MousePointerClick, PackagePlus } from 'lucide-react';
import {
  PRESCRIPTION_TYPE_LABELS,
  type PrescriptionRecord,
  type PrescriptionType,
} from '@/types/prescriptionTypes';
import { PrescriptionThumbnail } from '@/features/prescriptions/components/PrescriptionThumbnail';
import { PrescriptionQuickTypeButton } from '@/features/prescriptions/components/PrescriptionQuickTypeButton';

interface PrescriptionUnassignedTrayProps {
  records: PrescriptionRecord[];
  draggingId: string | null;
  pickerSource: PrescriptionRecord | null;
  assignError: string | null;
  enableAssign: boolean;
  testId?: string;
  cardTestIdPrefix?: string;
  title?: string;
  emptyLabel?: string;
  guidance?: string;
  pendingStockAssignId?: string | null;
  onDragStart: (event: React.DragEvent<HTMLDivElement>, record: PrescriptionRecord) => void;
  onDragEnd: () => void;
  onTogglePicker: (record: PrescriptionRecord) => void;
  onPreviewImage: (record: PrescriptionRecord, url: string) => void;
  onUpdateType?: (record: PrescriptionRecord, nextType: PrescriptionType) => Promise<void>;
  onAssignStock?: (record: PrescriptionRecord) => Promise<void> | void;
}

export const PrescriptionUnassignedTray: React.FC<PrescriptionUnassignedTrayProps> = ({
  records,
  draggingId,
  pickerSource,
  assignError,
  enableAssign,
  testId = 'prescription-unassigned-tray',
  cardTestIdPrefix = 'prescription-unassigned-card',
  title = 'Pendientes de asignación',
  emptyLabel = 'Sin recetas pendientes de asignación.',
  guidance = 'Arrastra a la fila y columna correctas, o usa "Elegir"',
  pendingStockAssignId = null,
  onDragStart,
  onDragEnd,
  onTogglePicker,
  onPreviewImage,
  onUpdateType,
  onAssignStock,
}) => {
  if (records.length === 0) {
    return (
      <p
        data-testid="prescription-unassigned-empty"
        className="rounded-xl border border-dashed border-slate-200 bg-white p-3 text-center text-[11px] text-slate-400"
      >
        {emptyLabel}
      </p>
    );
  }

  return (
    <div data-testid={testId} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
          <Inbox size={14} />
          {title} ({records.length})
        </div>
        {enableAssign && (
          <p className="hidden items-center gap-1 text-[10px] text-amber-700 sm:flex">
            <MousePointerClick size={11} />
            {guidance}
          </p>
        )}
      </header>
      <div className="flex flex-wrap gap-2">
        {records.map(record => {
          const isDragging = draggingId === record.id;
          const isPicker = pickerSource?.id === record.id;
          const isAssigningStock = pendingStockAssignId === record.id;
          return (
            <div
              key={record.id}
              data-testid={`${cardTestIdPrefix}-${record.id}`}
              draggable={enableAssign}
              onDragStart={event => onDragStart(event, record)}
              onDragEnd={onDragEnd}
              className={`flex flex-col items-center gap-1 rounded-lg border bg-white p-2 shadow-sm transition-opacity ${
                isDragging ? 'opacity-50' : 'opacity-100'
              } ${isPicker ? 'border-sky-400 ring-2 ring-sky-200' : 'border-slate-200'}`}
              style={{ cursor: enableAssign ? 'grab' : 'default' }}
            >
              <PrescriptionThumbnail
                thumbnailStoragePath={record.image.thumbnailStoragePath}
                fullStoragePath={record.image.storagePath}
                alt="Pendiente"
                onPreview={url => onPreviewImage(record, url)}
                className="h-14 w-14"
              />
              {onUpdateType ? (
                <PrescriptionQuickTypeButton
                  currentType={record.prescriptionType}
                  onChange={nextType => onUpdateType(record, nextType)}
                />
              ) : (
                <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
                  {PRESCRIPTION_TYPE_LABELS[record.prescriptionType]
                    .replace('Receta de ', '')
                    .replace('Receta ', '')}
                </span>
              )}
              {enableAssign && (
                <button
                  type="button"
                  onClick={() => onTogglePicker(record)}
                  className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                    isPicker
                      ? 'bg-sky-600 text-white hover:bg-sky-700'
                      : 'border border-sky-300 text-sky-700 hover:bg-sky-50'
                  }`}
                >
                  {isPicker ? 'Elegir cama…' : 'Asignar'}
                </button>
              )}
              {onAssignStock && (
                <button
                  type="button"
                  onClick={() => onAssignStock(record)}
                  disabled={isAssigningStock}
                  className="inline-flex items-center justify-center gap-1 rounded-md border border-emerald-300 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-wait disabled:opacity-70"
                >
                  {isAssigningStock ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <PackagePlus size={11} />
                  )}
                  {isAssigningStock ? 'Enviando…' : 'Enviar a Stock de Hospitalizados'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {assignError && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {assignError}
        </p>
      )}
    </div>
  );
};
