import React from 'react';
import { EmptyBedRow } from '@/features/census/components/EmptyBedRow';
import { PatientRow } from '@/features/census/components/PatientRow';
import {
  buildResolvedOccupiedRows,
  injectPendingClinicalCribCreateRows,
} from '@/features/census/controllers/censusTableBodyController';
import type { CensusTableBodyProps } from '@/features/census/types/censusTableComponentContracts';
import {
  usePendingClinicalCribCreates,
  usePendingIntentionalClearTargets,
} from '@/features/census/hooks/usePendingBedClearIds';

export const CensusTableBody: React.FC<CensusTableBodyProps> = ({
  unifiedRows,
  currentDateString,
  recordLastUpdated,
  readOnly,
  clinicalEditingDisabled = false,
  columns,
  visibleColumnCount,
  bedTypes,
  role,
  accessProfile,
  clinicalDocumentCountsByBedId,
  dischargedRuts,
  onAction,
  onActivateEmptyBed,
}) => {
  // Publish committed revisions before clicks without invalidating memoized rows.
  const recordLastUpdatedRef = React.useRef(recordLastUpdated);
  React.useLayoutEffect(() => {
    recordLastUpdatedRef.current = recordLastUpdated;
  }, [recordLastUpdated]);
  const getRecordLastUpdated = React.useCallback(() => recordLastUpdatedRef.current, []);

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
      clinicalDocumentCountsByBedId,
      dischargedRuts,
    });
    const map = new Map<string, (typeof resolved)[number]>();
    resolved.forEach(entry => map.set(entry.row.id, entry));
    return map;
  }, [projectedRows, currentDateString, clinicalDocumentCountsByBedId, dischargedRuts]);

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
              onActivate={onActivateEmptyBed}
            />
          );
        }

        const resolved = resolvedOccupiedMap.get(row.id);
        if (!resolved) return null;

        return (
          <PatientRow
            // A crib row is also keyed by its mother: another mother is another crib row (ID-05).
            key={row.saveScopeOwner ? `${row.id}:${row.saveScopeOwner}` : row.id}
            bed={row.bed}
            data={row.data}
            currentDateString={currentDateString}
            getRecordLastUpdated={getRecordLastUpdated}
            onAction={onAction}
            readOnly={readOnly || Boolean(row.isPendingCreate)}
            clinicalEditingDisabled={clinicalEditingDisabled}
            actionMenuAlign={resolved.actionMenuAlign}
            isSubRow={row.isSubRow}
            bedType={bedTypes[row.bed.id] ?? row.bed.type}
            role={role}
            accessProfile={accessProfile}
            indicators={resolved.indicators}
            clinicalDocumentCount={resolved.clinicalDocumentCount}
          />
        );
      })}
    </tbody>
  );
};
