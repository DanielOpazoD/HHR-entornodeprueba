import type { RowMenuAlign } from '@/features/census/components/patient-row/patientRowUiContracts';
import { buildOccupiedPatientRowIndicators } from '@/features/census/controllers/patientRowIndicatorsController';
import type { CensusTableResolvedOccupiedRow } from '@/features/census/types/censusTableComponentContracts';
import type { PatientData } from '@/features/census/types/censusTablePatientContracts';
import type { UnifiedBedRow } from '@/features/census/types/censusTableTypes';

const MENU_ALIGN_BOTTOM_THRESHOLD = 4;

const isOccupiedUnifiedBedRow = (
  row: UnifiedBedRow
): row is Extract<UnifiedBedRow, { kind: 'occupied' }> => row.kind === 'occupied';

const buildResolvedOccupiedRow = (
  row: Extract<UnifiedBedRow, { kind: 'occupied' }>,
  index: number,
  totalRows: number,
  currentDateString: string,
  clinicalDocumentPresenceByBedId: Record<string, boolean>,
  dischargedRuts: ReadonlySet<string>
): CensusTableResolvedOccupiedRow => ({
  row,
  actionMenuAlign: resolvePatientRowMenuAlign(index, totalRows),
  indicators: buildOccupiedPatientRowIndicators({
    isSubRow: row.isSubRow,
    currentDateString,
    firstSeenDate: row.data.firstSeenDate,
    admissionDate: row.data.admissionDate,
    admissionTime: row.data.admissionTime,
    hasClinicalDocument: Boolean(clinicalDocumentPresenceByBedId[row.bed.id]),
    wasDischargedSameDay: Boolean(row.data.rut && dischargedRuts.has(row.data.rut)),
  }),
});

export const resolvePatientRowMenuAlign = (index: number, totalRows: number): RowMenuAlign => {
  return index >= totalRows - MENU_ALIGN_BOTTOM_THRESHOLD ? 'bottom' : 'top';
};

interface BuildResolvedOccupiedRowsParams {
  unifiedRows: UnifiedBedRow[];
  currentDateString: string;
  clinicalDocumentPresenceByBedId: Record<string, boolean>;
  /**
   * Set of patient RUTs that were discharged on this census day.
   * Used to detect same-day readmissions for the new-admission badge.
   */
  dischargedRuts?: ReadonlySet<string>;
}

export const buildResolvedOccupiedRows = ({
  unifiedRows,
  currentDateString,
  clinicalDocumentPresenceByBedId,
  dischargedRuts = new Set(),
}: BuildResolvedOccupiedRowsParams): CensusTableResolvedOccupiedRow[] => {
  const occupiedRows = unifiedRows.filter(isOccupiedUnifiedBedRow);

  return occupiedRows.map((row, index) =>
    buildResolvedOccupiedRow(
      row,
      index,
      occupiedRows.length,
      currentDateString,
      clinicalDocumentPresenceByBedId,
      dischargedRuts
    )
  );
};

interface InjectPendingClinicalCribCreateRowsParams {
  unifiedRows: UnifiedBedRow[];
  pendingCreates: ReadonlyMap<string, PatientData>;
  /** Beds whose confirmed crib clear is still pending: a re-creation there must project too. */
  pendingClinicalCribClearBedIds: ReadonlySet<string>;
}

/**
 * Projects pending guarded crib creations as provisional sub-rows, mirroring how
 * pending clears hide rows: the visual result appears the moment the user
 * confirms, while the per-date queue keeps protecting only the remote commit.
 * Remote authority stays definitive — when the mutation settles, the row either
 * becomes the record's real crib or disappears with the rejected mutation.
 */
export const injectPendingClinicalCribCreateRows = ({
  unifiedRows,
  pendingCreates,
  pendingClinicalCribClearBedIds,
}: InjectPendingClinicalCribCreateRowsParams): UnifiedBedRow[] => {
  if (pendingCreates.size === 0) return unifiedRows;

  const bedsWithRecordCrib = new Set(
    unifiedRows.filter(row => row.kind === 'occupied' && row.isSubRow).map(row => row.bed.id)
  );

  const augmentedRows: UnifiedBedRow[] = [];
  unifiedRows.forEach(row => {
    augmentedRows.push(row);
    if (row.kind !== 'occupied' || row.isSubRow) return;
    const pendingCrib = pendingCreates.get(row.bed.id);
    if (!pendingCrib) return;
    // The record's own crib row wins unless a pending clear is hiding it (a
    // clear-then-recreate sequence must still show the recreated draft).
    if (bedsWithRecordCrib.has(row.bed.id) && !pendingClinicalCribClearBedIds.has(row.bed.id)) {
      return;
    }
    if (row.data.isBlocked) return;
    // Distinct id: while a pending clear hides the record's crib row, both rows
    // coexist in the array and React keys must not collide.
    augmentedRows.push({
      kind: 'occupied',
      id: `${row.bed.id}-cuna-pendiente`,
      bed: row.bed,
      data: pendingCrib,
      isSubRow: true,
      isPendingCreate: true,
    });
  });
  return augmentedRows;
};
