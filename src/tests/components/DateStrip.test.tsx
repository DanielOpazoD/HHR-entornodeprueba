import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DateStrip } from '@/components/layout/DateStrip';
import { ModuleType } from '@/constants/navigationConfig';

describe('DateStrip', () => {
  const defaultProps = {
    selectedYear: 2024,
    setSelectedYear: vi.fn(),
    selectedMonth: 1,
    setSelectedMonth: vi.fn(),
    selectedDay: 1,
    setSelectedDay: vi.fn(),
    currentDateString: '2024-01-01',
    daysInMonth: 31,
    existingDaysInMonth: [1, 2, 3],
    onExportPDF: vi.fn(),
    onOpenBedManager: vi.fn(),
    onExportExcel: vi.fn(),
    onConfigureEmail: vi.fn(),
    onSendEmail: vi.fn(),
    onCopyShareLink: vi.fn(),
    onBackupExcel: vi.fn(),
    isArchived: false,
    isBackingUp: false,
    currentModule: 'CENSUS' as ModuleType,
    emailStatus: 'idle' as const,
    emailErrorMessage: null,
    syncStatus: 'idle' as const,
    lastSyncTime: null,
    onToggleBookmarks: vi.fn(),
    showBookmarks: true,
    role: 'admin',
    onBackupPDF: vi.fn(),
    navigateDays: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders date selection components', async () => {
    render(<DateStrip {...defaultProps} />);
    expect(await screen.findByText('Febrero')).toBeInTheDocument();
    expect(await screen.findByText('2024')).toBeInTheDocument();
    // Check days strip
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument(); // 9 is the compact desktop visible end day
  });

  it('places census options after the dates without duplicate quick actions', async () => {
    render(
      <DateStrip
        {...defaultProps}
        hideQuickActions
        trailingActions={<button>Más opciones</button>}
      />
    );
    await screen.findByText('Febrero');
    const options = screen.getByRole('button', { name: 'Más opciones' });
    expect(options.closest('[data-app-top-bar]')).not.toBeNull();
    expect(
      screen.getByText('9').compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByTitle('Bloqueo de camas')).not.toBeInTheDocument();
  });

  it('renders clinical action buttons for admin in CENSUS module', async () => {
    render(<DateStrip {...defaultProps} />);

    expect(await screen.findByTitle('Descargar PDF (rápido)')).toBeInTheDocument();
    expect(await screen.findByTitle('Opciones de guardado')).toBeInTheDocument();
    expect(screen.queryByText('Guardar')).not.toBeInTheDocument();
    expect(await screen.findByTitle('Bloqueo de camas')).toBeInTheDocument();
    expect(await screen.findByTitle('Enviar censo')).toBeInTheDocument();
  });

  it('keeps daily census save immediately before send census in the action order', async () => {
    render(<DateStrip {...defaultProps} />);

    await screen.findByTitle('Enviar censo');
    await screen.findByTitle('Opciones de guardado');
    const buttons = screen.getAllByRole('button');
    const sendIndex = buttons.indexOf(screen.getByTitle('Enviar censo'));
    const saveIndex = buttons.indexOf(screen.getByTitle('Opciones de guardado'));

    expect(sendIndex).toBeGreaterThan(-1);
    expect(saveIndex).toBe(sendIndex - 1);
  });

  it('hides specific buttons when currentModule is not CENSUS', () => {
    render(
      <DateStrip {...defaultProps} currentModule="NURSING_HANDOFF" onOpenBedManager={undefined} />
    );
    expect(screen.queryByTitle('Bloqueo de camas')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Exportar Excel')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Buscar paciente (Ctrl+K)')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Radiología / Imagenología')).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Lab/)).not.toBeInTheDocument();
  });

  it('shows email status indicators', async () => {
    // Correct text for status indicators in EmailDropdown
    const { rerender } = render(<DateStrip {...defaultProps} emailStatus="loading" />);
    expect(await screen.findByText('Enviando...')).toBeInTheDocument();
    expect(await screen.findByTitle('Enviar censo')).toHaveAttribute(
      'data-email-status',
      'loading'
    );

    rerender(<DateStrip {...defaultProps} emailStatus="success" />);
    expect(await screen.findByText('Enviado')).toBeInTheDocument();
    expect(await screen.findByTitle('Enviar censo')).toHaveAttribute(
      'data-email-status',
      'success'
    );
  });

  it('blocks Excel email with an explanation, leaves configuration open, and unlocks after review', async () => {
    const reason = 'Envío bloqueado: completa la evaluación UPC del día en R1.';
    const { rerender } = render(<DateStrip {...defaultProps} emailBlockedReason={reason} />);
    fireEvent.click(await screen.findByTitle('Enviar censo'));
    const send = screen.getByRole('button', { name: /Enviar Archivo Excel/ });
    expect(send).toBeDisabled();
    fireEvent.click(send);
    expect(defaultProps.onSendEmail).not.toHaveBeenCalled();
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Configuración/ })).toBeEnabled();
    rerender(<DateStrip {...defaultProps} emailBlockedReason={null} />);
    expect(screen.queryByText(reason)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Enviar Archivo Excel/ }));
    expect(defaultProps.onSendEmail).toHaveBeenCalledTimes(1);
  });

  it('shows sync status indicators in SaveDropdown', async () => {
    // Sync status is actually reflected in SaveDropdown 'isArchived' and 'isBackingUp' props
    const { rerender } = render(<DateStrip {...defaultProps} isBackingUp={true} />);
    const savingButton = await screen.findByTitle('Opciones de guardado');
    expect(savingButton).toHaveAttribute('aria-label', 'Guardando...');
    expect(savingButton).toHaveAttribute('data-save-status', 'loading');

    rerender(<DateStrip {...defaultProps} isArchived={true} />);
    const archivedButton = await screen.findByTitle('Opciones de guardado');
    expect(archivedButton).toHaveAttribute('aria-label', 'Sincronizado');
    expect(archivedButton).toHaveAttribute('data-save-status', 'archived');
  });

  it('hides firebase backup option in census save menu', async () => {
    render(<DateStrip {...defaultProps} currentModule="CENSUS" />);

    fireEvent.click(await screen.findByTitle('Opciones de guardado'));

    expect(screen.getByText('Descargar Excel')).toBeInTheDocument();
    expect(screen.queryByText('Respaldo en Firebase')).not.toBeInTheDocument();
  });

  it('hides firebase backup option in nursing handoff save menu', async () => {
    render(<DateStrip {...defaultProps} currentModule="NURSING_HANDOFF" />);

    fireEvent.click(await screen.findByTitle('Opciones de guardado (PDF/Nube)'));

    expect(screen.getByText('Descargar PDF')).toBeInTheDocument();
    expect(screen.queryByText('Respaldo en Firebase')).not.toBeInTheDocument();
  });

  it('triggers actions when buttons are clicked', async () => {
    render(<DateStrip {...defaultProps} />);

    fireEvent.click(await screen.findByTitle('Descargar PDF (rápido)'));
    expect(defaultProps.onExportPDF).toHaveBeenCalled();

    fireEvent.click(await screen.findByTitle('Bloqueo de camas'));
    expect(defaultProps.onOpenBedManager).toHaveBeenCalled();

    // Initial showBookmarks is true, so title is "Ocultar Marcadores"
    fireEvent.click(await screen.findByTitle('Ocultar Marcadores'));
    expect(defaultProps.onToggleBookmarks).toHaveBeenCalled();
  });

  it('hides bookmark button for non-privileged roles', () => {
    render(<DateStrip {...defaultProps} role="viewer" />); // 'viewer' is Guest
    expect(screen.queryByTitle(/Marcadores/)).not.toBeInTheDocument();
  });

  it('disables send email button when loading', async () => {
    render(<DateStrip {...defaultProps} emailStatus="loading" />);
    const sendBtn = await screen.findByTitle('Enviar censo');
    expect(sendBtn).toBeDisabled();
  });

  it('navigates days when clicking day buttons', () => {
    render(<DateStrip {...defaultProps} />);
    // Day 5 should be visible even if selectedDay is 1 (endDay is 13)
    fireEvent.click(screen.getByText('5'));
    expect(defaultProps.setSelectedDay).toHaveBeenCalledWith(5);
  });
});
