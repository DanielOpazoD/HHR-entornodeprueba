import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TransferDocumentPackageModal } from '@/features/transfers/components/components/TransferDocumentPackageModal';

const mockAlert = vi.fn();
const mockOpen = vi.fn();

vi.mock('@/shared/runtime/browserWindowRuntime', () => ({
  defaultBrowserWindowRuntime: {
    alert: (...args: unknown[]) => mockAlert(...args),
    open: (...args: unknown[]) => mockOpen(...args),
  },
}));

const uploadToTransferFolder = vi.fn();
const makeFilePubliclyEditable = vi.fn();

vi.mock('@/services/google/googleDriveService', () => ({
  uploadToTransferFolder: (...args: unknown[]) => uploadToTransferFolder(...args),
  makeFilePubliclyEditable: (...args: unknown[]) => makeFilePubliclyEditable(...args),
}));

describe('TransferDocumentPackageModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    hospital: {
      id: 'h1',
      name: 'Hospital Test',
      code: 'HT',
      emails: { to: [], cc: [] },
      questions: [],
      templates: [],
    },
    patientData: {
      patientName: 'Paciente Demo',
      rut: '11.111.111-1',
      bedName: 'A1',
      bedType: 'BASICA',
      isUPC: false,
      originHospital: 'Origen',
    },
    documents: [
      {
        templateId: 'epicrisis',
        fileName: 'epicrisis.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        blob: new Blob(['demo'], { type: 'application/octet-stream' }),
        generatedAt: '2026-02-15T00:00:00.000Z',
      },
    ],
  };

  it('opens cloud link through runtime adapter when upload succeeds', async () => {
    uploadToTransferFolder.mockResolvedValue({
      fileId: 'file-1',
      webViewLink: 'https://drive.google.com/file-1',
      folderPath: 'Traslados HHR/2026/Febrero/Paciente_Demo_111111111',
    });
    makeFilePubliclyEditable.mockResolvedValue(undefined);

    render(<TransferDocumentPackageModal {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: /editar cloud/i }));

    await waitFor(() => {
      expect(mockOpen).toHaveBeenCalledWith('https://drive.google.com/file-1', '_blank');
    });
  });

  it('shows runtime alert with configured-message fallback when upload fails by missing setup', async () => {
    uploadToTransferFolder.mockRejectedValue(new Error('Drive client is not configured'));

    render(<TransferDocumentPackageModal {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: /editar cloud/i }));

    await waitFor(() => {
      expect(mockAlert).toHaveBeenCalledWith(
        'La edición online no está configurada aún (falta Client ID). Por favor, descarga el archivo para editarlo localmente.'
      );
    });
  });
});
