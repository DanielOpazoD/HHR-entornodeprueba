import { describe, expect, it } from 'vitest';
import { injectPendingClinicalCribCreateRows } from '@/features/census/controllers/censusTableBodyController';
import { BedType } from '@/features/census/contracts/censusBedContracts';
import type { BedDefinition } from '@/features/census/contracts/censusBedContracts';
import type { PatientData } from '@/features/census/types/censusTablePatientContracts';
import type { UnifiedBedRow } from '@/features/census/types/censusTableTypes';

const bed = (id: string): BedDefinition => ({ id, name: id, type: BedType.MEDIA, isCuna: false });

const patient = (overrides: Partial<PatientData> = {}): PatientData =>
  ({
    bedId: 'R1',
    patientName: 'Paciente Prueba',
    isBlocked: false,
    ...overrides,
  }) as PatientData;

const cribDraft = (): PatientData =>
  ({
    bedId: 'R1',
    bedMode: 'Cuna',
    identityStatus: 'provisional',
    patientName: 'RN de Paciente Prueba',
  }) as PatientData;

const occupiedRow = (bedId: string, data: PatientData): UnifiedBedRow => ({
  kind: 'occupied',
  id: bedId,
  bed: bed(bedId),
  data,
  isSubRow: false,
});

describe('injectPendingClinicalCribCreateRows', () => {
  it('projects a provisional read-only sub-row right after the parent bed', () => {
    const rows = injectPendingClinicalCribCreateRows({
      unifiedRows: [occupiedRow('R1', patient()), { kind: 'empty', id: 'R2', bed: bed('R2') }],
      pendingCreates: new Map([['R1', cribDraft()]]),
      pendingClinicalCribClearBedIds: new Set(),
    });

    expect(rows.map(row => row.id)).toEqual(['R1', 'R1-cuna-pendiente', 'R2']);
    const projected = rows[1];
    expect(projected.kind).toBe('occupied');
    if (projected.kind === 'occupied') {
      expect(projected.isSubRow).toBe(true);
      expect(projected.isPendingCreate).toBe(true);
      expect(projected.data.patientName).toBe('RN de Paciente Prueba');
    }
  });

  it('never duplicates the record-backed crib row', () => {
    const parent = occupiedRow('R1', patient());
    const recordCrib: UnifiedBedRow = {
      kind: 'occupied',
      id: 'R1-cuna',
      bed: bed('R1'),
      data: cribDraft(),
      isSubRow: true,
    };
    const rows = injectPendingClinicalCribCreateRows({
      unifiedRows: [parent, recordCrib],
      pendingCreates: new Map([['R1', cribDraft()]]),
      pendingClinicalCribClearBedIds: new Set(),
    });

    expect(rows.map(row => row.id)).toEqual(['R1', 'R1-cuna']);
  });

  it('projects the recreated draft while a pending clear still hides the record crib', () => {
    const parent = occupiedRow('R1', patient());
    const recordCrib: UnifiedBedRow = {
      kind: 'occupied',
      id: 'R1-cuna',
      bed: bed('R1'),
      data: cribDraft(),
      isSubRow: true,
    };
    const rows = injectPendingClinicalCribCreateRows({
      unifiedRows: [parent, recordCrib],
      pendingCreates: new Map([['R1', cribDraft()]]),
      pendingClinicalCribClearBedIds: new Set(['R1']),
    });

    expect(rows.map(row => row.id)).toEqual(['R1', 'R1-cuna-pendiente', 'R1-cuna']);
  });

  it('skips blocked beds and beds without a pending creation', () => {
    const rows = injectPendingClinicalCribCreateRows({
      unifiedRows: [
        occupiedRow('R1', patient({ isBlocked: true })),
        occupiedRow('R2', patient({ bedId: 'R2' })),
      ],
      pendingCreates: new Map([['R1', cribDraft()]]),
      pendingClinicalCribClearBedIds: new Set(),
    });

    expect(rows.map(row => row.id)).toEqual(['R1', 'R2']);
  });

  it('returns the same rows when nothing is pending', () => {
    const unifiedRows = [occupiedRow('R1', patient())];
    expect(
      injectPendingClinicalCribCreateRows({
        unifiedRows,
        pendingCreates: new Map(),
        pendingClinicalCribClearBedIds: new Set(),
      })
    ).toBe(unifiedRows);
  });
});
