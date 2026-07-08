import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TransferDocumentPackageModal } from '@/features/transfers/components/internal/TransferDocumentPackageModal';

const { mockAlert, mockOpen, mockConfirm, mockSuccess, mockInfo, mockWarning } = vi.hoisted(() => ({
  mockAlert: vi.fn(),
  mockOpen: vi.fn(),
  mockConfirm: vi.fn(),
  mockSuccess: vi.fn(),
  mockInfo: vi.fn(),
  mockWarning: vi.fn(),
}));

vi.mock('@/shared/runtime/browserWindowRuntimeCore', async () => {
  const { createMockBrowserWindowRuntime } = await import('@/tests/utils/browserWindowRuntimeMock');

  return {
    defaultBrowserWindowRuntime: createMockBrowserWindowRuntime({
      alert: mockAlert,
      open: mockOpen,
    }),
  };
});

vi.mock('@/context/UIContext', () => ({
  useConfirmDialog: () => ({
    confirm: (...args: unknown[]) => mockConfirm(...args),
  }),
  useNotification: () => ({
    success: (...args: unknown[]) => mockSuccess(...args),
    info: (...args: unknown[]) => mockInfo(...args),
    warning: (...args: unknown[]) => mockWarning(...args),
  }),
}));

const uploadToTransferFolder = vi.fn();
const makeFilePubliclyEditable = vi.fn();
const isGoogleDriveEditingConfigured = vi.fn();
const downloadDocument = vi.fn();
const downloadAllDocuments = vi.fn();

vi.mock('@/services/google/googleDriveService', () => ({
  uploadToTransferFolder: (...args: unknown[]) => uploadToTransferFolder(...args),
  makeFilePubliclyEditable: (...args: unknown[]) => makeFilePubliclyEditable(...args),
}));

vi.mock('@/services/google/googleDriveAuth', () => ({
  isGoogleDriveEditingConfigured: () => isGoogleDriveEditingConfigured(),
}));

vi.mock('@/services/transfers/documentGeneratorService', () => ({
  downloadDocument: (...args: unknown[]) => downloadDocument(...args),
  downloadAllDocuments: (...args: unknown[]) => downloadAllDocuments(...args),
}));

describe('TransferDocumentPackageModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isGoogleDriveEditingConfigured.mockReturnValue(true);
    downloadDocument.mockResolvedValue('saved');
    downloadAllDocuments.mockResolvedValue('directory');
    mockConfirm.mockResolvedValue(true);
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

  it('notifies with configured-message fallback when upload fails by missing setup', async () => {
    uploadToTransferFolder.mockRejectedValue(new Error('Drive client is not configured'));

    render(<TransferDocumentPackageModal {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: /editar cloud/i }));

    await waitFor(() => {
      expect(mockWarning).toHaveBeenCalledWith(
        'Edición online no configurada',
        'Falta el Client ID de Google. Descarga el archivo para editarlo localmente.'
      );
    });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it('disables cloud editing when Google Drive is not configured', () => {
    isGoogleDriveEditingConfigured.mockReturnValue(false);

    render(<TransferDocumentPackageModal {...baseProps} />);

    expect(screen.getByRole('button', { name: /cloud no disp\./i })).toBeDisabled();
  });

  it('removes the cloud info panel copy', () => {
    render(<TransferDocumentPackageModal {...baseProps} />);

    expect(screen.queryByText(/información de edición/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/sincronización segura con google workspace/i)
    ).not.toBeInTheDocument();
  });

  it('downloads a single document through the transfer generator service', async () => {
    render(<TransferDocumentPackageModal {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: /^descargar$/i }));

    await waitFor(() => {
      expect(downloadDocument).toHaveBeenCalledWith(baseProps.documents[0]);
    });
    expect(mockSuccess).toHaveBeenCalledWith('Documento guardado', 'epicrisis.docx');
  });

  it('downloads all documents together through the transfer generator service', async () => {
    render(<TransferDocumentPackageModal {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: /descargar todo/i }));

    await waitFor(() => {
      expect(downloadAllDocuments).toHaveBeenCalledWith(baseProps.documents);
    });
    expect(mockConfirm).toHaveBeenCalled();
    expect(mockSuccess).toHaveBeenCalledWith(
      'Documentos guardados',
      '1 archivo(s) guardados en la carpeta seleccionada.'
    );
  });

  it('shows a clear message when bulk download falls back to zip', async () => {
    downloadAllDocuments.mockResolvedValue('zip');

    render(<TransferDocumentPackageModal {...baseProps} />);

    fireEvent.click(screen.getByRole('button', { name: /descargar todo/i }));

    await waitFor(() => {
      expect(mockInfo).toHaveBeenCalledWith(
        'Descarga como ZIP',
        'Tu navegador no permite elegir una carpeta para varios archivos. Se descargó un ZIP con todos los documentos.'
      );
    });
  });
});
