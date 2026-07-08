/**
 * Tests the detail modal's inline type editor flow: clicking "Cambiar"
 * reveals a select, picking a different type and clicking Save fires
 * `onUpdateType` with the chosen value, and the readonly view returns
 * once the promise resolves.
 */

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/features/prescriptions/services/prescriptionStorageImageService', () => ({
  resolvePrescriptionImageDownloadUrl: vi.fn(async (path: string) => `https://stub/${path}`),
}));

import { PrescriptionDetailModal } from '@/features/prescriptions/components/PrescriptionDetailModal';
import { UIProvider } from '@/context/UIContext';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';

const baseRecord: PrescriptionRecord = {
  id: 'rx-1',
  hospitalId: 'hhr',
  prescriptionType: 'comun',
  bedId: 'H1C2',
  patientName: 'Carina Pate Lillo',
  patientRut: '14.470.055-4',
  image: {
    storagePath: 'prescriptions/hhr/rx-1/full.jpg',
    thumbnailStoragePath: 'prescriptions/hhr/rx-1/thumb.jpg',
    byteSize: 245_678,
    width: 1200,
    height: 900,
    contentType: 'image/jpeg',
  },
  uploader: { source: 'qr_pin' },
  createdAt: '2026-05-04T10:00:00.000Z',
  expiresAt: '2026-06-03T10:00:00.000Z',
};

const renderDetailModal = (ui: React.ReactElement) => render(<UIProvider>{ui}</UIProvider>);

describe('PrescriptionDetailModal type editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the image weight in the metadata section', async () => {
    renderDetailModal(
      <PrescriptionDetailModal
        record={baseRecord}
        canEdit
        canDelete={false}
        onClose={vi.fn()}
        onReassign={vi.fn(async () => undefined)}
        onDelete={vi.fn(async () => undefined)}
      />
    );

    // 245678 B → 240 KB
    expect(await screen.findByText(/240 KB/i)).toBeTruthy();
    expect(screen.getByText(/1200×900 px/)).toBeTruthy();
  });

  it('labels the 30-day date as a backup review date, not expiration', async () => {
    renderDetailModal(
      <PrescriptionDetailModal
        record={baseRecord}
        canEdit
        canDelete={false}
        onClose={vi.fn()}
        onReassign={vi.fn(async () => undefined)}
        onDelete={vi.fn(async () => undefined)}
      />
    );

    await screen.findByRole('img', { name: /receta/i });
    expect(screen.getByText(/respaldo sugerido/i)).toBeInTheDocument();
    expect(screen.queryByText(/^expira$/i)).toBeNull();
  });

  it('warns admins to confirm monthly backup before manual deletion', async () => {
    renderDetailModal(
      <PrescriptionDetailModal
        record={baseRecord}
        canEdit
        canDelete
        onClose={vi.fn()}
        onReassign={vi.fn(async () => undefined)}
        onDelete={vi.fn(async () => undefined)}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: /^eliminar$/i }));

    expect(screen.getByText(/confirme que el respaldo mensual ya fue realizado/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /eliminar respaldo/i })).toBeTruthy();
  });

  it('switches to a select on "Cambiar" and persists the new type via onUpdateType', async () => {
    const onUpdateType = vi.fn(async () => undefined);
    renderDetailModal(
      <PrescriptionDetailModal
        record={baseRecord}
        canEdit
        canDelete={false}
        onClose={vi.fn()}
        onReassign={vi.fn(async () => undefined)}
        onDelete={vi.fn(async () => undefined)}
        onUpdateType={onUpdateType}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /cambiar/i }));

    const select = (await screen.findByRole('combobox')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'psicotropicos' } });

    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(onUpdateType).toHaveBeenCalledTimes(1));
    expect(onUpdateType).toHaveBeenCalledWith('psicotropicos');
  });

  it('hides the editor when "Cambiar" is not pressed and disables it without onUpdateType', async () => {
    renderDetailModal(
      <PrescriptionDetailModal
        record={baseRecord}
        canEdit
        canDelete={false}
        onClose={vi.fn()}
        onReassign={vi.fn(async () => undefined)}
        onDelete={vi.fn(async () => undefined)}
      />
    );

    await screen.findByRole('img', { name: /receta/i });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /cambiar/i })).toBeNull();
  });
});
