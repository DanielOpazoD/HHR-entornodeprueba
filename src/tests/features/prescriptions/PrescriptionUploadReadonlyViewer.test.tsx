import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PrescriptionUploadReadonlyViewer } from '@/features/prescriptions/components/PrescriptionUploadReadonlyViewer';
import { buildPrescriptionUploadViewerDayOptions } from '@/features/prescriptions/components/prescriptionUploadReadonlyViewerSupport';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';

const mockListPrescriptionUploadReadonlyRecords = vi.fn();

vi.mock('@/features/prescriptions/services/prescriptionAccessService', () => ({
  listPrescriptionUploadReadonlyRecords: (payload: unknown) =>
    mockListPrescriptionUploadReadonlyRecords(payload),
}));

vi.mock('@/features/prescriptions/services/prescriptionStorageImageService', () => ({
  resolvePrescriptionImageDownloadUrl: vi.fn(async (path: string) => `https://stub/${path}`),
}));

vi.mock('@/features/prescriptions/components/PrescriptionListItem', () => ({
  PrescriptionListItem: ({
    record,
    onSelect,
  }: {
    record: PrescriptionRecord;
    onSelect: (record: PrescriptionRecord) => void;
  }) => (
    <button
      type="button"
      data-testid={`prescription-row-${record.id}`}
      onClick={() => onSelect(record)}
    >
      {record.patientName}
    </button>
  ),
}));

vi.mock('@/features/prescriptions/components/PrescriptionDetailModal', () => ({
  PrescriptionDetailModal: ({
    record,
    canEdit,
    canDelete,
  }: {
    record: PrescriptionRecord;
    canEdit: boolean;
    canDelete: boolean;
  }) => (
    <div
      data-testid="prescription-detail-modal"
      data-record-id={record.id}
      data-can-edit={String(canEdit)}
      data-can-delete={String(canDelete)}
    />
  ),
}));

const buildRecord = (overrides: Partial<PrescriptionRecord> = {}): PrescriptionRecord => ({
  id: 'rx-today',
  hospitalId: 'hhr',
  prescriptionType: 'comun',
  assignmentScope: 'patient',
  bedId: 'H1C2',
  patientName: 'Paciente Uno',
  patientRut: '11.111.111-1',
  notes: '',
  image: {
    storagePath: 'prescriptions/hhr/rx-today/full.jpg',
    thumbnailStoragePath: 'prescriptions/hhr/rx-today/thumb.jpg',
    byteSize: 12345,
    width: 1200,
    height: 900,
    contentType: 'image/jpeg',
  },
  uploader: {
    source: 'qr_pin',
    displayName: 'Farmacia',
  },
  createdAt: '2026-05-29T14:00:00.000Z',
  expiresAt: '2026-06-29T14:00:00.000Z',
  ...overrides,
});

describe('PrescriptionUploadReadonlyViewer', () => {
  beforeEach(() => {
    mockListPrescriptionUploadReadonlyRecords.mockReset();
    mockListPrescriptionUploadReadonlyRecords.mockResolvedValue({
      date: '2026-05-29',
      records: [buildRecord()],
    });
  });

  it('shows today and yesterday with day-month-year dates', async () => {
    render(<PrescriptionUploadReadonlyViewer isOpen onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /hoy.*\d{2}-\d{2}-\d{4}/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ayer.*\d{2}-\d{2}-\d{4}/i })).toBeInTheDocument();
    expect(await screen.findByTestId('prescription-row-rx-today')).toBeInTheDocument();
  });

  it('switches the clinical day filter to yesterday', async () => {
    const yesterday = buildPrescriptionUploadViewerDayOptions()[1];
    render(<PrescriptionUploadReadonlyViewer isOpen onClose={vi.fn()} />);
    mockListPrescriptionUploadReadonlyRecords.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /ayer/i }));

    await waitFor(() =>
      expect(mockListPrescriptionUploadReadonlyRecords).toHaveBeenCalledWith({
        date: yesterday.isoDate,
        pin: undefined,
      })
    );
  });

  it('passes the QR PIN to the readonly callable', async () => {
    const today = buildPrescriptionUploadViewerDayOptions()[0];
    render(<PrescriptionUploadReadonlyViewer isOpen onClose={vi.fn()} accessPin="7351" />);

    await waitFor(() =>
      expect(mockListPrescriptionUploadReadonlyRecords).toHaveBeenCalledWith({
        date: today.isoDate,
        pin: '7351',
      })
    );
  });

  it('opens uploaded prescriptions in a read-only detail modal', async () => {
    render(<PrescriptionUploadReadonlyViewer isOpen onClose={vi.fn()} />);

    fireEvent.click(await screen.findByTestId('prescription-row-rx-today'));

    expect(screen.getByTestId('prescription-detail-modal')).toHaveAttribute(
      'data-record-id',
      'rx-today'
    );
    expect(screen.getByTestId('prescription-detail-modal')).toHaveAttribute(
      'data-can-edit',
      'false'
    );
    expect(screen.getByTestId('prescription-detail-modal')).toHaveAttribute(
      'data-can-delete',
      'false'
    );
  });

  it('uses a dated empty state when there are no uploads for the selected day', async () => {
    mockListPrescriptionUploadReadonlyRecords.mockResolvedValue({
      date: '2026-05-29',
      records: [],
    });

    render(<PrescriptionUploadReadonlyViewer isOpen onClose={vi.fn()} />);

    expect(
      await screen.findByText(/sin recetas subidas el \d{2}-\d{2}-\d{4}/i)
    ).toBeInTheDocument();
  });

  it('shows a readable error when the mobile readonly callable fails', async () => {
    mockListPrescriptionUploadReadonlyRecords.mockRejectedValue(new Error('PIN inválido.'));

    render(<PrescriptionUploadReadonlyViewer isOpen onClose={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('PIN inválido.');
  });
});
