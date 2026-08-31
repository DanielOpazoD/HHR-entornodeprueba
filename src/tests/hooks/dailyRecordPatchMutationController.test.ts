import { act, renderHook, waitFor } from '@testing-library/react';
import { useMutation } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
  getDailyRecordPatchMutationKey,
  resolvePendingClinicalCribCreateTarget,
  resolvePendingIntentionalClearTarget,
} from '@/hooks/controllers/dailyRecordPatchMutationController';
import {
  usePendingClinicalCribCreates,
  usePendingIntentionalClearTargets,
} from '@/features/census/hooks/usePendingBedClearIds';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';

describe('dailyRecordPatchMutationController', () => {
  it('distinguishes a pending bed clear from a pending clinical-crib clear', () => {
    expect(
      resolvePendingIntentionalClearTarget({
        partial: { 'beds.R1': {} },
        options: {
          intentionalBedClear: {
            bedId: 'R1',
            confirmedLastUpdated: '2026-08-29T12:00:00.000Z',
            confirmedOccupant: { patientName: 'Paciente' },
          },
        },
      })
    ).toEqual({ bedId: 'R1', target: 'bed' });

    expect(
      resolvePendingIntentionalClearTarget({
        partial: { 'beds.R1.clinicalCrib': null },
        options: {
          intentionalBedClear: {
            bedId: 'R1',
            target: 'clinicalCrib',
            confirmedLastUpdated: '2026-08-29T12:00:00.000Z',
            confirmedOccupant: { patientName: 'RN' },
          },
        },
      })
    ).toEqual({ bedId: 'R1', target: 'clinicalCrib' });
    expect(resolvePendingIntentionalClearTarget({ 'beds.R1.status': 'Estable' })).toBeNull();
  });

  it('scopes pending markers by census date', () => {
    expect(getDailyRecordPatchMutationKey('2026-08-29')).toEqual([
      'dailyRecordPatch',
      '2026-08-29',
    ]);
  });

  it('exposes the bed only while its authority mutation is pending', async () => {
    let resolveWrite!: () => void;
    const write = new Promise<void>(resolve => {
      resolveWrite = resolve;
    });
    const { wrapper } = createQueryClientTestWrapper();
    const { result } = renderHook(
      () => {
        const mutation = useMutation<void, Error, unknown>({
          mutationKey: getDailyRecordPatchMutationKey('2026-08-29'),
          mutationFn: async () => write,
        });
        return {
          mutation,
          pendingTargets: usePendingIntentionalClearTargets('2026-08-29'),
        };
      },
      { wrapper }
    );

    act(() => {
      result.current.mutation.mutate({
        partial: { 'beds.R1': {} },
        options: {
          intentionalBedClear: {
            bedId: 'R1',
            confirmedLastUpdated: '2026-08-29T12:00:00.000Z',
            confirmedOccupant: { patientName: 'Paciente' },
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.pendingTargets.bedIds.has('R1')).toBe(true);
      expect(result.current.pendingTargets.clinicalCribBedIds.has('R1')).toBe(false);
    });

    resolveWrite();
    await waitFor(() => {
      expect(result.current.pendingTargets.bedIds.has('R1')).toBe(false);
    });
  });

  it('exposes a clinical crib independently while its authority mutation is pending', async () => {
    let resolveWrite!: () => void;
    const write = new Promise<void>(resolve => {
      resolveWrite = resolve;
    });
    const { wrapper } = createQueryClientTestWrapper();
    const { result } = renderHook(
      () => {
        const mutation = useMutation<void, Error, unknown>({
          mutationKey: getDailyRecordPatchMutationKey('2026-08-29'),
          mutationFn: async () => write,
        });
        return {
          mutation,
          pendingTargets: usePendingIntentionalClearTargets('2026-08-29'),
        };
      },
      { wrapper }
    );

    act(() => {
      result.current.mutation.mutate({
        partial: { 'beds.R1.clinicalCrib': null },
        options: {
          intentionalBedClear: {
            bedId: 'R1',
            target: 'clinicalCrib',
            confirmedLastUpdated: '2026-08-29T12:00:00.000Z',
            confirmedOccupant: { patientName: 'RN' },
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.pendingTargets.bedIds.has('R1')).toBe(false);
      expect(result.current.pendingTargets.clinicalCribBedIds.has('R1')).toBe(true);
    });

    resolveWrite();
    await waitFor(() => {
      expect(result.current.pendingTargets.clinicalCribBedIds.has('R1')).toBe(false);
    });
  });

  it('resolves the crib draft of a pending guarded creation and rejects other shapes', () => {
    const crib = { bedId: 'R1', bedMode: 'Cuna', identityStatus: 'provisional' };
    expect(
      resolvePendingClinicalCribCreateTarget({
        partial: { 'beds.R1.clinicalCrib': crib, 'beds.R1.hasCompanionCrib': false },
        options: {
          clinicalCribCreate: {
            bedId: 'R1',
            confirmedLastUpdated: '2026-08-29T12:00:00.000Z',
            confirmedParent: { patientName: 'Paciente' },
          },
        },
      })
    ).toEqual({ bedId: 'R1', crib });

    // Sin comando de creación, o sin borrador de cuna en el patch, no hay proyección.
    expect(
      resolvePendingClinicalCribCreateTarget({
        partial: { 'beds.R1.clinicalCrib': crib },
        options: {},
      })
    ).toBeNull();
    expect(
      resolvePendingClinicalCribCreateTarget({
        partial: { 'beds.R1.clinicalCrib': null },
        options: {
          clinicalCribCreate: {
            bedId: 'R1',
            confirmedLastUpdated: '2026-08-29T12:00:00.000Z',
            confirmedParent: { patientName: 'Paciente' },
          },
        },
      })
    ).toBeNull();
    expect(resolvePendingClinicalCribCreateTarget({ 'beds.R1.status': 'Estable' })).toBeNull();
  });

  it('exposes the crib draft only while its guarded creation is pending', async () => {
    let resolveWrite!: () => void;
    const write = new Promise<void>(resolve => {
      resolveWrite = resolve;
    });
    const { wrapper } = createQueryClientTestWrapper();
    const { result } = renderHook(
      () => {
        const mutation = useMutation<void, Error, unknown>({
          mutationKey: getDailyRecordPatchMutationKey('2026-08-29'),
          mutationFn: async () => write,
        });
        return {
          mutation,
          pendingCreates: usePendingClinicalCribCreates('2026-08-29'),
        };
      },
      { wrapper }
    );

    act(() => {
      result.current.mutation.mutate({
        partial: {
          'beds.R1.clinicalCrib': { bedId: 'R1', bedMode: 'Cuna', identityStatus: 'provisional' },
        },
        options: {
          clinicalCribCreate: {
            bedId: 'R1',
            confirmedLastUpdated: '2026-08-29T12:00:00.000Z',
            confirmedParent: { patientName: 'Paciente' },
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.pendingCreates.get('R1')).toMatchObject({ bedMode: 'Cuna' });
    });

    resolveWrite();
    await waitFor(() => {
      expect(result.current.pendingCreates.has('R1')).toBe(false);
    });
  });
});
