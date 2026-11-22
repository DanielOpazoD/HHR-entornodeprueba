import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DocumentScannerQueueView } from '@/features/document-scanner/components/DocumentScannerQueueView';

const mockListScannedDocuments = vi.fn();
const mockConfirmScannedDocumentUploaded = vi.fn();

vi.mock('@/features/document-scanner/services/documentScannerQueueService', () => ({
  listScannedDocuments: (...args: unknown[]) => mockListScannedDocuments(...args),
  confirmScannedDocumentUploaded: (...args: unknown[]) =>
    mockConfirmScannedDocumentUploaded(...args),
}));

describe('DocumentScannerQueueView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a back link to the daily census and does not claim empty queue when loading fails', async () => {
    mockListScannedDocuments.mockRejectedValueOnce(new Error('Error temporal de conexión'));

    render(<DocumentScannerQueueView />);

    expect(screen.getByRole('link', { name: /volver al censo diario/i })).toHaveAttribute(
      'href',
      '/'
    );
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Error temporal de conexión');
    });
    expect(screen.queryByText('No hay documentos pendientes')).not.toBeInTheDocument();
  });

  it('shows the empty confirmation only after a successful empty read', async () => {
    mockListScannedDocuments.mockResolvedValueOnce({ documents: [] });

    render(<DocumentScannerQueueView />);

    expect(await screen.findByText('No hay documentos pendientes')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
