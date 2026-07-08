/**
 * Tests the reassign dialog's day-resolution fallback: if today's daily
 * record has no eligible beds, the dialog walks back day-by-day up to 7
 * days and uses the most recent day with active patients. Confirms the
 * dropdown is populated and a successful pick fires `onSubmit` with the
 * matching bed/patient/RUT.
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: vi.fn(),
}));

import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { PrescriptionReassignDialog } from '@/features/prescriptions/components/PrescriptionReassignDialog';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';

const baseRecord: PrescriptionRecord = {
  id: 'rx-1',
  hospitalId: 'hhr',
  prescriptionType: 'comun',
  image: {
    storagePath: 'prescriptions/hhr/rx-1/full.jpg',
    thumbnailStoragePath: 'prescriptions/hhr/rx-1/thumb.jpg',
    byteSize: 200_000,
    width: 1200,
    height: 900,
    contentType: 'image/jpeg',
  },
  uploader: { source: 'qr_pin' },
  createdAt: '2026-05-04T10:00:00.000Z',
  expiresAt: '2026-06-03T10:00:00.000Z',
};

const buildEmptyDay = (): DailyRecord =>
  ({
    date: '2026-05-05',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-05-05T10:00:00.000Z',
    activeExtraBeds: [],
  }) as unknown as DailyRecord;

const buildPopulatedDay = (): DailyRecord =>
  ({
    date: '2026-05-04',
    beds: {
      H1C2: {
        bedId: 'H1C2',
        isBlocked: false,
        bedMode: 'Cama',
        hasCompanionCrib: false,
        patientName: 'Carina Pate Lillo',
        rut: '14.470.055-4',
        age: '60',
        pathology: '—',
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-05-04T10:00:00.000Z',
    activeExtraBeds: [],
  }) as unknown as DailyRecord;

const buildMovementDay = (): DailyRecord =>
  ({
    ...buildPopulatedDay(),
    discharges: [
      {
        id: 'discharge-1',
        bedId: 'H2C3',
        bedName: 'H2C3',
        patientName: 'Paciente Alta',
        rut: '22.222.222-2',
      },
    ],
    transfers: [
      {
        id: 'transfer-1',
        bedId: 'H3C4',
        bedName: 'H3C4',
        patientName: 'Paciente Traslado',
        rut: '33.333.333-3',
      },
    ],
  }) as unknown as DailyRecord;

describe('PrescriptionReassignDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to a previous day when the requested day has no active beds', async () => {
    vi.mocked(getRecordFromFirestore).mockImplementation(async (iso: string) => {
      // 2026-05-05 = today (empty), 2026-05-04 = yesterday (has beds)
      if (iso === '2026-05-05') return buildEmptyDay();
      if (iso === '2026-05-04') return buildPopulatedDay();
      return null;
    });

    render(
      <PrescriptionReassignDialog
        record={baseRecord}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => undefined)}
        selectedDate="2026-05-05"
      />
    );

    // Wait for the fallback to resolve and the dropdown to appear with H1C2.
    await waitFor(() =>
      expect(screen.getByText(/H1C2 · Carina Pate Lillo \(14\.470\.055-4\)/)).toBeTruthy()
    );

    // Notice text indicating fallback day was used.
    expect(screen.getByText(/se usó el día más reciente con pacientes/i)).toBeTruthy();
  });

  it('submits the selected bed with patient name + RUT from the daily record', async () => {
    vi.mocked(getRecordFromFirestore).mockResolvedValue(buildPopulatedDay());
    const onSubmit = vi.fn(async () => undefined);
    const onClose = vi.fn();

    render(
      <PrescriptionReassignDialog
        record={baseRecord}
        onClose={onClose}
        onSubmit={onSubmit}
        selectedDate="2026-05-04"
      />
    );

    const select = (await screen.findByRole('combobox')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'H1C2' } });

    const saveButton = screen.getByRole('button', { name: /guardar/i });
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      bedId: 'H1C2',
      patientName: 'Carina Pate Lillo',
      patientRut: '14.470.055-4',
      clear: false,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('labels current-day bed options as active, discharged or transferred', async () => {
    vi.mocked(getRecordFromFirestore).mockResolvedValue(buildMovementDay());

    render(
      <PrescriptionReassignDialog
        record={baseRecord}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => undefined)}
        selectedDate="2026-05-04"
      />
    );

    await screen.findByRole('combobox');
    expect(screen.getByRole('option', { name: /H1C2.*Carina Pate Lillo.*Activo/i })).toBeTruthy();
    expect(
      screen.getByRole('option', { name: /H2C3.*Paciente Alta.*Alta \(egreso\)/i })
    ).toBeTruthy();
    expect(screen.getByRole('option', { name: /H3C4.*Paciente Traslado.*Traslado/i })).toBeTruthy();
  });
});
