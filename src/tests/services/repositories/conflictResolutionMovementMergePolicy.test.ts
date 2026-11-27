// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { reconcileMovementListThreeWay } from '@/services/repositories/conflictResolutionMovementMergePolicy';

describe('reconcileMovementListThreeWay (SAVE-02)', () => {
  const d1 = { id: 'dis-1', patientName: 'Paciente Uno', diagnosis: 'Dx Base 1', time: '10:00' };
  const d2 = { id: 'dis-2', patientName: 'Paciente Dos', diagnosis: 'Dx Base 2', time: '11:00' };

  it('merges disjoint edits on different patients while preserving both changes', () => {
    const stored = [{ ...d1, time: '10:15' }, d2];
    const incoming = [d1, { ...d2, diagnosis: 'Dx Editado 2' }];

    expect(reconcileMovementListThreeWay([d1, d2], stored, incoming)).toEqual([
      { ...d1, time: '10:15' },
      { ...d2, diagnosis: 'Dx Editado 2' },
    ]);
  });

  it('preserves remote additions and appends local additions on distinct IDs', () => {
    const d3 = { id: 'dis-3', patientName: 'Paciente Tres', diagnosis: 'Dx 3', time: '12:00' };
    const d4 = { id: 'dis-4', patientName: 'Paciente Cuatro', diagnosis: 'Dx 4', time: '13:00' };

    expect(reconcileMovementListThreeWay([d1], [d1, d3], [d1, d4])).toEqual([d1, d3, d4]);
  });

  it('preserves remote removal or soft-delete while applying a disjoint local edit', () => {
    const stored = [{ ...d1, deletedAt: '2026-11-27T12:00:00.000Z' }, d2];
    const incoming = [d1, { ...d2, time: '11:30' }];

    expect(reconcileMovementListThreeWay([d1, d2], stored, incoming)).toEqual([
      { ...d1, deletedAt: '2026-11-27T12:00:00.000Z' },
      { ...d2, time: '11:30' },
    ]);
    expect(reconcileMovementListThreeWay([d1, d2], [d2], incoming)).toEqual([
      { ...d2, time: '11:30' },
    ]);
  });

  it('applies a local removal while keeping a disjoint remote edit', () => {
    const stored = [{ ...d1, time: '10:20' }, d2];
    const incoming = [d1];

    expect(reconcileMovementListThreeWay([d1, d2], stored, incoming)).toEqual([
      { ...d1, time: '10:20' },
    ]);
  });

  it('accepts identical concurrent edits to the same movement ID', () => {
    const edited = { ...d1, time: '10:45' };
    expect(reconcileMovementListThreeWay([d1, d2], [edited, d2], [edited, d2])).toEqual([
      edited,
      d2,
    ]);
  });

  it('returns null (conflict) when both writers change the same movement ID differently', () => {
    const stored = [{ ...d1, time: '10:15' }, d2];
    const incoming = [{ ...d1, time: '10:30' }, d2];

    expect(reconcileMovementListThreeWay([d1, d2], stored, incoming)).toBeNull();
  });

  it('returns null (conflict) when one writer removes/soft-deletes and the other edits the same ID', () => {
    const edited = [{ ...d1, diagnosis: 'Dx Nuevo' }, d2];
    expect(reconcileMovementListThreeWay([d1, d2], [d2], edited)).toBeNull();
    expect(
      reconcileMovementListThreeWay(
        [d1, d2],
        [{ ...d1, deletedAt: '2026-11-27T12:00:00.000Z' }, d2],
        edited
      )
    ).toBeNull();
  });

  it('fails closed when any item lacks an explicit unique ID', () => {
    expect(
      reconcileMovementListThreeWay(
        [{ patientName: 'Sin ID' }],
        [{ patientName: 'Sin ID A' }],
        [{ patientName: 'Sin ID B' }]
      )
    ).toBeNull();
    expect(reconcileMovementListThreeWay([d1], [d1, d1], [d1])).toBeNull();
  });
});
