import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ClinicalDocumentStatusBar } from '@/features/clinical-documents/components/ClinicalDocumentStatusBar';

const defaultStatusProps = {
  hasLocalDraftChanges: false,
};

describe('ClinicalDocumentStatusBar', () => {
  it('always renders the autosave indicator in a reserved slot, idle when there are no changes', () => {
    render(
      <ClinicalDocumentStatusBar
        {...defaultStatusProps}
        hasLocalDraftChanges={false}
        isSaving={false}
        isUploadingPdf={false}
        onUploadPdf={() => {}}
      />
    );

    const indicator = screen.getByRole('status');
    expect(indicator).toHaveAttribute('data-autosave-phase', 'idle');
    expect(indicator).toHaveAccessibleName(/sin cambios pendientes/i);
    expect(screen.queryByText(/actualización remota pendiente/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /recargar remoto/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /descartar local/i })).not.toBeInTheDocument();
  });

  it('switches the autosave indicator to a dirty state when there are local changes', () => {
    render(
      <ClinicalDocumentStatusBar
        {...defaultStatusProps}
        hasLocalDraftChanges={true}
        isSaving={false}
        isUploadingPdf={false}
        onUploadPdf={() => {}}
      />
    );

    const indicator = screen.getByRole('status');
    expect(indicator).toHaveAttribute('data-autosave-phase', 'dirty');
    expect(indicator).toHaveAccessibleName(/cambios locales sin guardar/i);
    expect(screen.queryByText(/actualización remota pendiente/i)).not.toBeInTheDocument();
  });

  it('switches the autosave indicator to a saving state while a write is in flight', () => {
    render(
      <ClinicalDocumentStatusBar
        {...defaultStatusProps}
        hasLocalDraftChanges={true}
        isSaving={true}
        isUploadingPdf={false}
        onUploadPdf={() => {}}
      />
    );

    const indicator = screen.getByRole('status');
    expect(indicator).toHaveAttribute('data-autosave-phase', 'saving');
    expect(indicator).toHaveAccessibleName(/guardando cambios/i);
  });

  it('exposes the saved timestamp in the autosave indicator once persistence completes', () => {
    render(
      <ClinicalDocumentStatusBar
        {...defaultStatusProps}
        hasLocalDraftChanges={false}
        isSaving={false}
        lastSavedAt="2026-03-06T10:30:00.000Z"
        isUploadingPdf={false}
        onUploadPdf={() => {}}
      />
    );

    const indicator = screen.getByRole('status');
    expect(indicator).toHaveAttribute('data-autosave-phase', 'saved');
    expect(indicator).toHaveAccessibleName(/cambios guardados a las \d{2}:\d{2}/i);
  });

  it('shows an exported Drive state with a direct link', () => {
    render(
      <ClinicalDocumentStatusBar
        {...defaultStatusProps}
        isSaving={false}
        lastSavedAt="2026-03-06T10:30:00.000Z"
        isUploadingPdf={false}
        pdf={{
          exportStatus: 'exported',
          webViewLink: 'https://drive.google.com/file',
          exportedAt: '2026-03-06T10:31:00.000Z',
        }}
        onUploadPdf={() => {}}
      />
    );

    expect(screen.getByText(/drive exportado/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /abrir drive/i })).toHaveAttribute(
      'href',
      'https://drive.google.com/file'
    );
  });

  it('shows failed Drive state and delegates retry', () => {
    const onUploadPdf = vi.fn();

    render(
      <ClinicalDocumentStatusBar
        {...defaultStatusProps}
        isSaving={false}
        isUploadingPdf={false}
        pdf={{
          exportStatus: 'failed',
          exportError: 'drive down',
        }}
        onUploadPdf={onUploadPdf}
      />
    );

    expect(screen.getByText(/drive falló/i)).toBeInTheDocument();
    expect(screen.getByText(/drive down/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reintentar drive/i }));
    expect(onUploadPdf).toHaveBeenCalledTimes(1);
  });
});
