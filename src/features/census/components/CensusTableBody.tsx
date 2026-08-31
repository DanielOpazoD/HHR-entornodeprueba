import React from 'react';
import { EmptyBedRow } from '@/features/census/components/EmptyBedRow';
import { PatientRow } from '@/features/census/components/PatientRow';
import {
  buildResolvedOccupiedRows,
  injectPendingClinicalCribCreateRows,
} from '@/features/census/controllers/censusTableBodyController';
import type { CensusTableBodyProps } from '@/features/census/types/censusTableComponentContracts';
import type { CensusTableDragDropBundle } from '@/features/census/drag-drop/dragDropContracts';
import type { ClinicalDocumentPresenceInfo } from '@/features/census/controllers/clinicalDocumentPresenceController';
import {
  usePendingClinicalCribCreates,
  usePendingIntentionalClearTargets,
} from '@/features/census/hooks/usePendingBedClearIds';

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
  recordLastUpdated,
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
  const pendingClearTargets = usePendingIntentionalClearTargets(currentDateString);
  // A confirmed crib creation projects its provisional row at click time, exactly
  // like pending clears hide theirs: the per-date queue keeps serializing only the
  // remote commit, never the user's perception.
  const pendingCribCreates = usePendingClinicalCribCreates(currentDateString);
  const projectedRows = React.useMemo(
    () =>
      injectPendingClinicalCribCreateRows({
        unifiedRows,
        pendingCreates: pendingCribCreates,
        pendingClinicalCribClearBedIds: pendingClearTargets.clinicalCribBedIds,
      }),
    [unifiedRows, pendingCribCreates, pendingClearTargets.clinicalCribBedIds]
  );
  const resolvedOccupiedMap = React.useMemo(() => {
    const resolved = buildResolvedOccupiedRows({
      unifiedRows: projectedRows,
      currentDateString,
      clinicalDocumentPresenceByBedId,
      dischargedRuts,
    });
    const map = new Map<string, (typeof resolved)[number]>();
    resolved.forEach(entry => map.set(entry.row.id, entry));
    return map;
  }, [projectedRows, currentDateString, clinicalDocumentPresenceByBedId, dischargedRuts]);

  return (
    <tbody>
      {projectedRows.map(row => {
        const isPendingBedClear = pendingClearTargets.bedIds.has(row.bed.id);
        const isPendingClinicalCribClear = pendingClearTargets.clinicalCribBedIds.has(row.bed.id);

        // A confirmed clear is an optimistic, reversible command. Project its visible result as
        // soon as React Query marks the mutation pending, even when the mutation is still waiting
        // for an earlier write on this date. Remote authority remains definitive: on rejection the
        // pending target disappears and the authoritative occupied row is rendered again.
        if (
          row.kind === 'occupied' &&
          row.isSubRow &&
          !row.isPendingCreate &&
          (isPendingBedClear || isPendingClinicalCribClear)
        ) {
          return null;
        }

        if (
          row.kind === 'empty' ||
          (row.kind === 'occupied' && !row.isSubRow && isPendingBedClear)
        ) {
          return (
            <EmptyBedRow
              key={row.id}
              bed={row.bed}
              columns={columns}
              visibleColumnCount={visibleColumnCount}
              readOnly={readOnly || isPendingBedClear}
              isPendingClear={isPendingBedClear}
              onClick={() => onActivateEmptyBed(row.bed.id)}
              isDragOver={!isPendingBedClear && dragDrop?.state.dragOverBedId === row.bed.id}
              onDragOver={
                isPendingBedClear ? undefined : dragDrop?.emptyBedHandlers.onDragOver(row.bed.id)
              }
              onDragEnter={
                isPendingBedClear ? undefined : dragDrop?.emptyBedHandlers.onDragEnter(row.bed.id)
              }
              onDragLeave={dragDrop?.emptyBedHandlers.onDragLeave}
              onDrop={isPendingBedClear ? undefined : dragDrop?.emptyBedHandlers.onDrop(row.bed.id)}
            />
          );
        }

        const resolved = resolvedOccupiedMap.get(row.id);
        if (!resolved) return null;
        const clinicalFieldLocks = clinicalFieldLocksByBedId?.[row.bed.id];

        return (
          <PatientRow
            key={row.id}
            bed={row.bed}
            data={row.data}
            currentDateString={currentDateString}
            recordLastUpdated={recordLastUpdated}
            onAction={onAction}
            readOnly={readOnly || Boolean(row.isPendingCreate)}
            clinicalEditingDisabled={clinicalEditingDisabled}
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
