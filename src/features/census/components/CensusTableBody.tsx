import React from 'react';
import { EmptyBedRow } from '@/features/census/components/EmptyBedRow';
import { PatientRow } from '@/features/census/components/PatientRow';
import { buildResolvedOccupiedRows } from '@/features/census/controllers/censusTableBodyController';
import type { CensusTableBodyProps } from '@/features/census/types/censusTableComponentContracts';
import type { CensusTableDragDropBundle } from '@/features/census/drag-drop/dragDropContracts';
import type { ClinicalDocumentPresenceInfo } from '@/features/census/controllers/clinicalDocumentPresenceController';

export interface CensusTableBodyDragDropProps {
  dragDrop?: CensusTableDragDropBundle;
}

export interface CensusTableBodyBadgeProps {
  clinicalDocumentInfoByBedId?: Record<string, ClinicalDocumentPresenceInfo>;
}

export const CensusTableBody: React.FC<
  CensusTableBodyProps & CensusTableBodyDragDropProps & CensusTableBodyBadgeProps
> = ({
  unifiedRows,
  currentDateString,
  readOnly,
  clinicalEditingDisabled = false,
  clinicalFieldLocksByBedId,
  diagnosisMode,
  columns,
  visibleColumnCount,
  bedTypes,
  role,
  accessProfile,
  clinicalDocumentPresenceByBedId,
  dischargedRuts,
  onAction,
  onActivateEmptyBed,
  dragDrop,
  clinicalDocumentInfoByBedId,
}) => {
  const resolvedOccupiedMap = React.useMemo(() => {
    const resolved = buildResolvedOccupiedRows({
      unifiedRows,
      currentDateString,
      clinicalDocumentPresenceByBedId,
      dischargedRuts,
    });
    const map = new Map<string, (typeof resolved)[number]>();
    resolved.forEach(entry => map.set(entry.row.id, entry));
    return map;
  }, [unifiedRows, currentDateString, clinicalDocumentPresenceByBedId, dischargedRuts]);

  return (
    <tbody>
      {unifiedRows.map(row => {
        if (row.kind === 'empty') {
          return (
            <EmptyBedRow
              key={row.id}
              bed={row.bed}
              columns={columns}
              visibleColumnCount={visibleColumnCount}
              readOnly={readOnly}
              onClick={() => onActivateEmptyBed(row.bed.id)}
              isDragOver={dragDrop?.state.dragOverBedId === row.bed.id}
              onDragOver={dragDrop?.emptyBedHandlers.onDragOver(row.bed.id)}
              onDragEnter={dragDrop?.emptyBedHandlers.onDragEnter(row.bed.id)}
              onDragLeave={dragDrop?.emptyBedHandlers.onDragLeave}
              onDrop={dragDrop?.emptyBedHandlers.onDrop(row.bed.id)}
            />
          );
        }

        const resolved = resolvedOccupiedMap.get(row.id);
        if (!resolved) return null;
        const clinicalFieldLocks = clinicalFieldLocksByBedId?.[row.bed.id];
        const rowClinicalEditingDisabled = clinicalEditingDisabled;

        return (
          <PatientRow
            key={row.id}
            bed={row.bed}
            data={row.data}
            currentDateString={currentDateString}
            onAction={onAction}
            readOnly={readOnly}
            clinicalEditingDisabled={rowClinicalEditingDisabled}
            clinicalFieldLocks={clinicalFieldLocks}
            actionMenuAlign={resolved.actionMenuAlign}
            diagnosisMode={diagnosisMode}
            isSubRow={row.isSubRow}
            bedType={bedTypes[row.bed.id]}
            role={role}
            accessProfile={accessProfile}
            indicators={resolved.indicators}
            draggable={!readOnly && !row.isSubRow && !!dragDrop}
            isDragging={dragDrop?.state.dragSourceBedId === row.bed.id}
            onDragStart={dragDrop?.patientHandlers.onDragStart(row.bed.id)}
            onDragEnd={dragDrop?.patientHandlers.onDragEnd}
            clinicalDocumentCount={clinicalDocumentInfoByBedId?.[row.bed.id]?.totalCount}
          />
        );
      })}
    </tbody>
  );
};
