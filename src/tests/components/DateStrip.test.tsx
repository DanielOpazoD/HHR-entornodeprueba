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
    localViewMode: 'TABLE' as const,
    setLocalViewMode: vi.fn(),
    onBackupPDF: vi.fn(),
    navigateDays: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders date selection components', () => {
    render(<DateStrip {...defaultProps} />);
    expect(screen.getByText('Febrero')).toBeInTheDocument();
    expect(screen.getByText('2024')).toBeInTheDocument();
    // Check days strip
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument(); // 13 is the default visible end day
  });

  it('renders clinical action buttons for admin in CENSUS module', () => {
    render(<DateStrip {...defaultProps} />);

    expect(screen.getByTitle('Descargar PDF (rápido)')).toBeInTheDocument();
    expect(screen.getByTitle('Opciones de guardado')).toBeInTheDocument();
    expect(screen.getByTitle('Bloqueo de camas')).toBeInTheDocument();
    expect(screen.getByTitle('Enviar censo')).toBeInTheDocument();
  });

  it('hides specific buttons when currentModule is not CENSUS', () => {
    render(
      <DateStrip {...defaultProps} currentModule="NURSING_HANDOFF" onOpenBedManager={undefined} />
    );
    expect(screen.queryByTitle('Bloqueo de camas')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Exportar Excel')).not.toBeInTheDocument();
  });

  it('shows email status indicators', () => {
    // Correct text for status indicators in EmailDropdown
    const { rerender } = render(<DateStrip {...defaultProps} emailStatus="loading" />);
    expect(screen.getByText('Enviando...')).toBeInTheDocument();

    rerender(<DateStrip {...defaultProps} emailStatus="success" />);
    expect(screen.getByText('Enviado')).toBeInTheDocument();
  });

  it('shows sync status indicators in SaveDropdown', () => {
    // Sync status is actually reflected in SaveDropdown 'isArchived' and 'isBackingUp' props
    const { rerender } = render(<DateStrip {...defaultProps} isBackingUp={true} />);
    expect(screen.getByText('Guardando...')).toBeInTheDocument();

    rerender(<DateStrip {...defaultProps} isArchived={true} />);
    expect(screen.getByText('Sincronizado')).toBeInTheDocument();
  });

  it('triggers actions when buttons are clicked', () => {
    render(<DateStrip {...defaultProps} />);

    fireEvent.click(screen.getByTitle('Descargar PDF (rápido)'));
    expect(defaultProps.onExportPDF).toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Bloqueo de camas'));
    expect(defaultProps.onOpenBedManager).toHaveBeenCalled();

    // Initial showBookmarks is true, so title is "Ocultar Marcadores"
    fireEvent.click(screen.getByTitle('Ocultar Marcadores'));
    expect(defaultProps.onToggleBookmarks).toHaveBeenCalled();
  });

  it('hides bookmark button for non-privileged roles', () => {
    render(<DateStrip {...defaultProps} role="viewer" />); // 'viewer' is Guest
    expect(screen.queryByTitle(/Marcadores/)).not.toBeInTheDocument();
  });

  it('disables send email button when loading', () => {
    render(<DateStrip {...defaultProps} emailStatus="loading" />);
    const sendBtn = screen.getByTitle('Enviar censo');
    expect(sendBtn).toBeDisabled();
  });

  it('navigates days when clicking day buttons', () => {
    render(<DateStrip {...defaultProps} />);
    // Day 5 should be visible even if selectedDay is 1 (endDay is 13)
    fireEvent.click(screen.getByText('5'));
    expect(defaultProps.setSelectedDay).toHaveBeenCalledWith(5);
  });

  it('toggles local view mode button', () => {
    render(<DateStrip {...defaultProps} localViewMode="TABLE" />);
    fireEvent.click(screen.getByTitle('Ver Mapa 3D'));
    expect(defaultProps.setLocalViewMode).toHaveBeenCalledWith('3D');
  });
});
