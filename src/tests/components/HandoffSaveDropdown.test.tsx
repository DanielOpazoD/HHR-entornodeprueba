import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { HandoffSaveDropdown } from '@/components/layout/date-strip/actions/HandoffSaveDropdown';

describe('HandoffSaveDropdown', () => {
  it('runs local export first and then triggers firebase backup when clicking "Descargar PDF"', async () => {
    const onExportPDF = vi.fn();
    const onBackupPDF = vi.fn().mockResolvedValue(undefined);

    render(
      <HandoffSaveDropdown
        onExportPDF={onExportPDF}
        onBackupPDF={onBackupPDF}
        isArchived={false}
        isBackingUp={false}
      />
    );

    fireEvent.click(screen.getByTitle('Opciones de guardado (PDF/Nube)'));
    fireEvent.click(screen.getByText('Descargar PDF'));

    await waitFor(() => {
      expect(onExportPDF).toHaveBeenCalledTimes(1);
      expect(onBackupPDF).toHaveBeenCalledTimes(1);
      expect(onBackupPDF).toHaveBeenCalledWith(true);
    });
    expect(onExportPDF.mock.invocationCallOrder[0]).toBeLessThan(
      onBackupPDF.mock.invocationCallOrder[0]
    );
  });

  it('runs browser print without triggering the generated PDF backup path', async () => {
    const onExportPDF = vi.fn();
    const onPrintWithBrowserOptions = vi.fn();
    const onBackupPDF = vi.fn().mockResolvedValue(undefined);

    render(
      <HandoffSaveDropdown
        onExportPDF={onExportPDF}
        onPrintWithBrowserOptions={onPrintWithBrowserOptions}
        onBackupPDF={onBackupPDF}
        isArchived={false}
        isBackingUp={false}
      />
    );

    fireEvent.click(screen.getByTitle('Opciones de guardado (PDF/Nube)'));
    expect(screen.queryByText('Imprimir con opciones')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Imprimir con opciones de Chrome'));

    expect(onPrintWithBrowserOptions).toHaveBeenCalledTimes(1);
    expect(onExportPDF).not.toHaveBeenCalled();
    expect(onBackupPDF).not.toHaveBeenCalled();
  });

  it('runs only firebase backup when clicking "Respaldo en Firebase"', async () => {
    const onExportPDF = vi.fn();
    const onBackupPDF = vi.fn().mockResolvedValue(undefined);

    render(
      <HandoffSaveDropdown
        onExportPDF={onExportPDF}
        onBackupPDF={onBackupPDF}
        isArchived={false}
        isBackingUp={false}
      />
    );

    fireEvent.click(screen.getByTitle('Opciones de guardado (PDF/Nube)'));
    fireEvent.click(screen.getByText('Respaldo en Firebase'));

    expect(onBackupPDF).toHaveBeenCalledTimes(1);
    expect(onBackupPDF).toHaveBeenCalledWith(false);
    expect(onExportPDF).not.toHaveBeenCalled();
  });

  it('hides firebase backup action when disabled for nursing users', () => {
    render(
      <HandoffSaveDropdown
        onExportPDF={vi.fn()}
        onBackupPDF={vi.fn().mockResolvedValue(undefined)}
        isArchived={false}
        isBackingUp={false}
        showFirebaseBackupOption={false}
      />
    );

    fireEvent.click(screen.getByTitle('Opciones de guardado (PDF/Nube)'));

    expect(screen.getByText('Descargar PDF')).toBeInTheDocument();
    expect(screen.getByText('Exportacion local')).toBeInTheDocument();
    expect(screen.queryByText('Respaldo en Firebase')).not.toBeInTheDocument();
  });
});
