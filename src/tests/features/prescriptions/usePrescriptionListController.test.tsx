/**
 * Tests for the visor list controller hook. Stubs the repository's
 * `subscribeToList` so we can drive the hook with synthetic snapshots
 * and exercise filtering logic without Firestore.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

vi.mock('@/services/repositories/PrescriptionRepository', () => ({
  PrescriptionRepository: {
    subscribeToList: vi.fn(),
  },
}));

import { PrescriptionRepository } from '@/services/repositories/PrescriptionRepository';
import {
  usePrescriptionListController,
  type PrescriptionListControllerHandle,
} from '@/features/prescriptions/hooks/usePrescriptionListController';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';

const buildRecord = (
  id: string,
  overrides: Partial<PrescriptionRecord> = {}
): PrescriptionRecord => ({
  id,
  hospitalId: 'hhr',
  prescriptionType: 'comun',
  bedId: 'H5C1',
  patientName: 'Paciente',
  patientRut: '11.111.111-1',
  notes: undefined,
  image: {
    storagePath: `prescriptions/hhr/${id}/full.jpg`,
    thumbnailStoragePath: `prescriptions/hhr/${id}/thumb.jpg`,
    byteSize: 200_000,
    width: 1200,
    height: 900,
    contentType: 'image/jpeg',
  },
  uploader: { source: 'authenticated', uid: 'u1', email: 'enf@h.cl' },
  createdAt: '2026-05-05T10:00:00.000Z',
  expiresAt: '2026-06-03T10:00:00.000Z',
  ...overrides,
});

const Probe: React.FC<{
  onReady: (handle: PrescriptionListControllerHandle) => void;
}> = ({ onReady }) => {
  const controller = usePrescriptionListController();
  React.useEffect(() => {
    onReady(controller);
  }, [controller, onReady]);
  return null;
};

const setupController = () => {
  let pushSnapshot: (next: PrescriptionRecord[]) => void = () => undefined;
  vi.mocked(PrescriptionRepository.subscribeToList).mockImplementation(callback => {
    pushSnapshot = callback;
    return () => {};
  });

  let captured!: PrescriptionListControllerHandle;
  render(
    <Probe
      onReady={handle => {
        captured = handle;
      }}
    />
  );

  return {
    pushSnapshot,
    handle: () => captured,
  };
};

describe('usePrescriptionListController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in loading phase before the first snapshot arrives', () => {
    const { handle } = setupController();
    expect(handle().phase).toBe('loading');
    expect(handle().records).toEqual([]);
  });

  it('flips to ready after the first snapshot and exposes records', async () => {
    const { pushSnapshot, handle } = setupController();
    await act(async () => {
      pushSnapshot([buildRecord('rx-1')]);
    });
    expect(handle().phase).toBe('ready');
    expect(handle().records).toHaveLength(1);
  });

  it('defaults to the current day so previous-day prescriptions are hidden on first load', async () => {
    const { pushSnapshot, handle } = setupController();
    await act(async () => {
      pushSnapshot([
        buildRecord('rx-today', { createdAt: '2026-05-05T09:00:00.000Z' }),
        buildRecord('rx-yesterday', { createdAt: '2026-05-04T22:00:00.000Z' }),
      ]);
    });

    expect(handle().filters.selectedDate).toBe('2026-05-05');
    expect(handle().filteredRecords.map(r => r.id)).toEqual(['rx-today']);
  });

  it('filters by prescription type', async () => {
    const { pushSnapshot, handle } = setupController();
    await act(async () => {
      pushSnapshot([
        buildRecord('rx-1', { prescriptionType: 'comun' }),
        buildRecord('rx-2', { prescriptionType: 'psicotropicos' }),
      ]);
    });
    await act(async () => {
      handle().setFilter('type', 'psicotropicos');
    });
    expect(handle().filteredRecords.map(r => r.id)).toEqual(['rx-2']);
  });

  it('filters by patient assignment status (unassigned)', async () => {
    const { pushSnapshot, handle } = setupController();
    await act(async () => {
      pushSnapshot([
        buildRecord('rx-with', { bedId: 'H5C1', patientName: 'Paciente' }),
        buildRecord('rx-blank', {
          bedId: undefined,
          patientName: undefined,
          patientRut: undefined,
        }),
      ]);
    });
    await act(async () => {
      handle().setFilter('patient', 'unassigned');
    });
    expect(handle().filteredRecords.map(r => r.id)).toEqual(['rx-blank']);
  });

  it('filters Stock de Hospitalizados separately from unassigned prescriptions', async () => {
    const { pushSnapshot, handle } = setupController();
    await act(async () => {
      pushSnapshot([
        buildRecord('rx-stock', {
          assignmentScope: 'hospitalized_stock',
          bedId: undefined,
          patientName: undefined,
          patientRut: undefined,
        }),
        buildRecord('rx-blank', {
          bedId: undefined,
          patientName: undefined,
          patientRut: undefined,
        }),
      ]);
    });

    await act(async () => {
      handle().setFilter('patient', 'hospitalized_stock');
    });
    expect(handle().filteredRecords.map(r => r.id)).toEqual(['rx-stock']);

    await act(async () => {
      handle().setFilter('patient', 'unassigned');
    });
    expect(handle().filteredRecords.map(r => r.id)).toEqual(['rx-blank']);
  });

  it('filters by free-text search across bed, patient, notes, uploader', async () => {
    const { pushSnapshot, handle } = setupController();
    await act(async () => {
      pushSnapshot([
        buildRecord('rx-1', { patientName: 'Pedro Pérez' }),
        buildRecord('rx-2', {
          bedId: 'X9',
          patientName: 'Otro',
          notes: 'cefalea persistente',
        }),
        buildRecord('rx-3', {
          uploader: { source: 'authenticated', email: 'dr.juan@hospital.cl' },
        }),
      ]);
    });

    await act(async () => {
      handle().setFilter('search', 'cefalea');
    });
    expect(handle().filteredRecords.map(r => r.id)).toEqual(['rx-2']);

    await act(async () => {
      handle().setFilter('search', 'dr.juan');
    });
    expect(handle().filteredRecords.map(r => r.id)).toEqual(['rx-3']);
  });

  it('resetFilters wipes every filter back to defaults', async () => {
    const { pushSnapshot, handle } = setupController();
    await act(async () => {
      pushSnapshot([buildRecord('rx-1', { prescriptionType: 'comun' })]);
    });
    await act(async () => {
      handle().setFilter('type', 'psicotropicos');
      handle().setFilter('search', 'algo');
    });
    expect(handle().filteredRecords).toHaveLength(0);

    await act(async () => {
      handle().resetFilters();
    });
    expect(handle().filters).toEqual({
      type: 'all',
      patient: 'all',
      search: '',
      selectedDate: '2026-05-05',
    });
    expect(handle().filteredRecords).toHaveLength(1);
  });
});
