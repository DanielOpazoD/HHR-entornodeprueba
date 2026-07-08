import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ClinicalDocumentIndicationsPanelHeader } from '@/features/clinical-documents/components/ClinicalDocumentIndicationsPanelHeader';

describe('ClinicalDocumentIndicationsPanelHeader', () => {
  it('renders actions and delegates export, import and close events', () => {
    const onToggleTransferMenu = vi.fn();
    const onExportCatalog = vi.fn();
    const onImportFile = vi.fn();
    const onClose = vi.fn();
    const fileInputRef = {
      current: null,
    } as unknown as React.RefObject<HTMLInputElement>;

    const { container, rerender } = render(
      <ClinicalDocumentIndicationsPanelHeader
        canEdit={true}
        isSavingCustomIndication={false}
        isTransferMenuOpen={false}
        fileInputRef={fileInputRef}
        onToggleTransferMenu={onToggleTransferMenu}
        onExportCatalog={onExportCatalog}
        onImportFile={onImportFile}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByLabelText('Importar o exportar mis indicaciones'));
    expect(onToggleTransferMenu).toHaveBeenCalledTimes(1);

    rerender(
      <ClinicalDocumentIndicationsPanelHeader
        canEdit={true}
        isSavingCustomIndication={false}
        isTransferMenuOpen={true}
        fileInputRef={fileInputRef}
        onToggleTransferMenu={onToggleTransferMenu}
        onExportCatalog={onExportCatalog}
        onImportFile={onImportFile}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByText('Exportar archivo'));
    fireEvent.click(screen.getByText('Importar archivo'));
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['{}'], 'catalog.json', { type: 'application/json' })] },
    });
    fireEvent.click(screen.getByLabelText('Cerrar panel de indicaciones'));

    expect(onExportCatalog).toHaveBeenCalledTimes(1);
    expect(onImportFile).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables import while editing is blocked', () => {
    const fileInputRef = {
      current: {
        click: vi.fn(),
      },
    } as unknown as React.RefObject<HTMLInputElement>;

    render(
      <ClinicalDocumentIndicationsPanelHeader
        canEdit={false}
        isSavingCustomIndication={true}
        isTransferMenuOpen={true}
        fileInputRef={fileInputRef}
        onToggleTransferMenu={vi.fn()}
        onExportCatalog={vi.fn()}
        onImportFile={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Importar archivo')).toBeDisabled();
  });
});
