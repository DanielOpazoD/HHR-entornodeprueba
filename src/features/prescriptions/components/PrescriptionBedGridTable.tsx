import React from 'react';
import {
  PRESCRIPTION_TYPE_LABELS,
  type PrescriptionRecord,
  type PrescriptionType,
} from '@/types/prescriptionTypes';
import {
  PrescriptionBedRow,
  type PrescriptionBedRowData,
} from '@/features/prescriptions/components/PrescriptionBedRow';
import { PRESCRIPTION_TYPES } from '@/features/prescriptions/components/prescriptionBedGridSupport';

interface PrescriptionBedGridTableProps {
  rows: PrescriptionBedRowData[];
  draggingRecord: PrescriptionRecord | null;
  hoverCell: { bedId: string; type: PrescriptionType } | null;
  pickerSource: PrescriptionRecord | null;
  pendingAssignId: string | null;
  enableDrop: boolean;
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
  onPickerAssign: (record: PrescriptionRecord, row: PrescriptionBedRowData) => Promise<void>;
  onPreviewImage: (record: PrescriptionRecord, url: string) => void;
  onUpdateType?: (record: PrescriptionRecord, nextType: PrescriptionType) => Promise<void>;
  onReassignRecord?: (record: PrescriptionRecord) => void;
}

export const PrescriptionBedGridTable: React.FC<PrescriptionBedGridTableProps> = ({
  rows,
  draggingRecord,
  hoverCell,
  pickerSource,
  pendingAssignId,
  enableDrop,
  onDragOver,
  onDragLeave,
  onDrop,
  onPickerAssign,
  onPreviewImage,
  onUpdateType,
  onReassignRecord,
}) => (
  <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
    <table className="w-full min-w-[640px] table-fixed text-sm">
      <colgroup>
        <col className="w-[64px]" />
        <col />
        {PRESCRIPTION_TYPES.map(type => (
          <col key={type} className="w-[160px]" />
        ))}
      </colgroup>
      <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <tr>
          <th className="px-2 py-2 text-left">Cama</th>
          <th className="px-2 py-2 text-left">Paciente</th>
          {PRESCRIPTION_TYPES.map(type => (
            <th key={type} className="px-2 py-2 text-center">
              {PRESCRIPTION_TYPE_LABELS[type].replace('Receta de ', '').replace('Receta ', '')}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <PrescriptionBedRow
            key={row.bedId}
            row={row}
            draggingRecord={draggingRecord}
            hoverCell={hoverCell}
            pickerSource={pickerSource}
            pendingAssignId={pendingAssignId}
            enableDrop={enableDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onPickerAssign={onPickerAssign}
            onPreviewImage={onPreviewImage}
            onUpdateType={onUpdateType}
            onReassignRecord={onReassignRecord}
          />
        ))}
      </tbody>
    </table>
  </div>
);
