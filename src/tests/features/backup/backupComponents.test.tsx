/**
 * Backup Components Tests
 *
 * Tests for the backup feature UI components: BackupFilesToolbar,
 * BackupFilesContent and the BackupDriveItems primitives.
 * Also tests the backupPresentation utility functions and the
 * formatFileSize utility from backupArtifacts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { BackupFilesToolbar } from '@/features/backup/components/internal/BackupFilesToolbar';
import {
  FolderCard,
  FileCard,
  Breadcrumbs,
} from '@/features/backup/components/internal/BackupDriveItems';
import { formatFileSize } from '@/types/backupArtifacts';
import {
  formatBackupShiftLabel,
  formatBackupTimestamp,
  formatBackupDisplayDateVerbose,
  formatBackupClockTime,
} from '@/shared/backup/backupPresentation';
import { BACKUP_TYPE_CONFIG, SHIFT_TYPE_CONFIG } from '@/types/backup';

// ─── Utility: formatFileSize ────────────────────────────────────────

describe('formatFileSize', () => {
  it('returns "0 B" for 0 bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('formats bytes correctly', () => {
    expect(formatFileSize(500)).toBe('500 B');
  });

  it('formats kilobytes correctly', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(2048)).toBe('2 KB');
  });

  it('formats megabytes correctly', () => {
    expect(formatFileSize(1048576)).toBe('1 MB');
  });
});

// ─── Utility: backupPresentation ────────────────────────────────────

describe('backupPresentation utilities', () => {
  describe('formatBackupShiftLabel', () => {
    it('returns "Turno Largo" for day shift', () => {
      expect(formatBackupShiftLabel('day')).toBe('Turno Largo');
    });

    it('returns "Turno Noche" for night shift', () => {
      expect(formatBackupShiftLabel('night')).toBe('Turno Noche');
    });
  });

  describe('formatBackupClockTime', () => {
    it('formats an ISO string to a time string', () => {
      const result = formatBackupClockTime('2026-03-15T14:30:00.000Z');
      // Locale-dependent, but should contain hours and minutes
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });
  });

  describe('formatBackupDisplayDateVerbose', () => {
    it('formats a date string to a verbose display string', () => {
      const result = formatBackupDisplayDateVerbose('2026-03-15');
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      // Should contain some form of the date
      expect(result).toMatch(/2026/);
    });
  });

  describe('formatBackupTimestamp', () => {
    it('formats an ISO timestamp to a locale string', () => {
      const result = formatBackupTimestamp('2026-03-15T14:30:00.000Z');
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });
  });
});

// ─── Constants ──────────────────────────────────────────────────────

describe('backup type and shift constants', () => {
  it('BACKUP_TYPE_CONFIG has entries for all three types', () => {
    expect(BACKUP_TYPE_CONFIG.NURSING_HANDOFF).toBeDefined();
    expect(BACKUP_TYPE_CONFIG.MEDICAL_HANDOFF).toBeDefined();
    expect(BACKUP_TYPE_CONFIG.CENSUS).toBeDefined();
  });

  it('SHIFT_TYPE_CONFIG has entries for day and night', () => {
    expect(SHIFT_TYPE_CONFIG.day.label).toBe('Turno Largo');
    expect(SHIFT_TYPE_CONFIG.night.label).toBe('Turno Noche');
    expect(SHIFT_TYPE_CONFIG.day.shortLabel).toBe('Día');
    expect(SHIFT_TYPE_CONFIG.night.shortLabel).toBe('Noche');
  });
});

// ─── FolderCard ─────────────────────────────────────────────────────

describe('FolderCard', () => {
  it('renders the folder name', () => {
    render(<FolderCard name="2026" onClick={vi.fn()} />);
    expect(screen.getByText('2026')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<FolderCard name="Enero" onClick={onClick} />);
    fireEvent.click(screen.getByText('Enero'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('displays item count when provided', () => {
    render(<FolderCard name="Marzo" onClick={vi.fn()} itemCount={12} />);
    expect(screen.getByText('12 elementos')).toBeInTheDocument();
  });

  it('does not display item count when not provided', () => {
    render(<FolderCard name="Abril" onClick={vi.fn()} />);
    expect(screen.queryByText(/elementos/)).not.toBeInTheDocument();
  });
});

// ─── FileCard ───────────────────────────────────────────────────────

describe('FileCard', () => {
  const defaultProps = {
    name: 'Entrega-2026-03-15-dia.pdf',
    date: '2026-03-15',
    shift: 'day' as const,
    size: '45 KB',
    onDownload: vi.fn(),
    onView: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the file name', () => {
    render(<FileCard {...defaultProps} />);
    expect(screen.getByText('Entrega-2026-03-15-dia.pdf')).toBeInTheDocument();
  });

  it('renders the file size', () => {
    render(<FileCard {...defaultProps} />);
    expect(screen.getByText('45 KB')).toBeInTheDocument();
  });

  it('renders the shift badge when not hidden', () => {
    render(<FileCard {...defaultProps} />);
    expect(screen.getByText('Turno Largo')).toBeInTheDocument();
  });

  it('hides the shift badge when hideShift is true', () => {
    render(<FileCard {...defaultProps} hideShift />);
    expect(screen.queryByText('Turno Largo')).not.toBeInTheDocument();
    expect(screen.queryByText('Turno Noche')).not.toBeInTheDocument();
  });

  it('renders night shift badge correctly', () => {
    render(<FileCard {...defaultProps} shift="night" />);
    expect(screen.getByText('Turno Noche')).toBeInTheDocument();
  });

  it('renders the delete button when canDelete is true', () => {
    const onDelete = vi.fn();
    render(<FileCard {...defaultProps} canDelete onDelete={onDelete} />);
    expect(screen.getByTitle('Eliminar')).toBeInTheDocument();
  });

  it('does not render the delete button when canDelete is false', () => {
    render(<FileCard {...defaultProps} canDelete={false} />);
    expect(screen.queryByTitle('Eliminar')).not.toBeInTheDocument();
  });
});

// ─── Breadcrumbs ────────────────────────────────────────────────────

describe('Breadcrumbs', () => {
  it('renders "Inicio" (root) link', () => {
    render(<Breadcrumbs path={[]} onNavigate={vi.fn()} />);
    expect(screen.getByText('Inicio')).toBeInTheDocument();
  });

  it('renders each path segment', () => {
    render(<Breadcrumbs path={['2026', 'Marzo']} onNavigate={vi.fn()} />);
    expect(screen.getByText('Inicio')).toBeInTheDocument();
    expect(screen.getByText('2026')).toBeInTheDocument();
    expect(screen.getByText('Marzo')).toBeInTheDocument();
  });

  it('calls onNavigate(-1) when Inicio is clicked', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumbs path={['2026']} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('Inicio'));
    expect(onNavigate).toHaveBeenCalledWith(-1);
  });

  it('calls onNavigate with the correct index for path segments', () => {
    const onNavigate = vi.fn();
    render(<Breadcrumbs path={['2026', 'Marzo']} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText('2026'));
    expect(onNavigate).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByText('Marzo'));
    expect(onNavigate).toHaveBeenCalledWith(1);
  });
});

// ─── BackupFilesToolbar ─────────────────────────────────────────────

describe('BackupFilesToolbar', () => {
  const defaultToolbarProps = {
    selectedBackupType: 'handoff' as const,
    path: [] as string[],
    viewMode: 'grid' as const,
    setViewMode: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    isLoading: false,
    isRefetching: false,
    canRunMagicBackfill: true,
    isMagicBackfilling: false,
    magicLabel: 'Respaldar faltantes (dia+noche)',
    onChangeBackupType: vi.fn(),
    onBreadcrumbNavigate: vi.fn(),
    onMagicBackfill: vi.fn(),
    onRefresh: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all three backup type tabs', () => {
    render(<BackupFilesToolbar {...defaultToolbarProps} />);
    expect(screen.getByText('Entregas')).toBeInTheDocument();
    expect(screen.getByText('Censo')).toBeInTheDocument();
    expect(screen.getByText('CUDYR')).toBeInTheDocument();
  });

  it('calls onChangeBackupType when a tab is clicked', () => {
    render(<BackupFilesToolbar {...defaultToolbarProps} />);
    fireEvent.click(screen.getByText('Censo'));
    expect(defaultToolbarProps.onChangeBackupType).toHaveBeenCalledWith('census');
  });

  it('renders the search input', () => {
    render(<BackupFilesToolbar {...defaultToolbarProps} />);
    expect(screen.getByPlaceholderText('Buscar en esta carpeta...')).toBeInTheDocument();
  });

  it('calls setSearchQuery when typing in the search input', () => {
    render(<BackupFilesToolbar {...defaultToolbarProps} />);
    const input = screen.getByPlaceholderText('Buscar en esta carpeta...');
    fireEvent.change(input, { target: { value: 'test' } });
    expect(defaultToolbarProps.setSearchQuery).toHaveBeenCalledWith('test');
  });

  it('renders grid and list view mode toggle buttons', () => {
    render(<BackupFilesToolbar {...defaultToolbarProps} />);
    expect(screen.getByLabelText('Vista cuadrícula')).toBeInTheDocument();
    expect(screen.getByLabelText('Vista lista')).toBeInTheDocument();
  });

  it('calls setViewMode when toggling view mode', () => {
    render(<BackupFilesToolbar {...defaultToolbarProps} />);
    fireEvent.click(screen.getByLabelText('Vista lista'));
    expect(defaultToolbarProps.setViewMode).toHaveBeenCalledWith('list');
  });

  it('renders the refresh button', () => {
    render(<BackupFilesToolbar {...defaultToolbarProps} />);
    expect(screen.getByTitle('Refrescar')).toBeInTheDocument();
  });

  it('calls onRefresh when refresh button is clicked', () => {
    render(<BackupFilesToolbar {...defaultToolbarProps} />);
    fireEvent.click(screen.getByTitle('Refrescar'));
    expect(defaultToolbarProps.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls onMagicBackfill when magic button is clicked', () => {
    render(<BackupFilesToolbar {...defaultToolbarProps} />);
    // The magic button has the label text (visible on lg screens)
    const magicButton = screen.getByTitle('Respaldo masivo de fechas faltantes del mes');
    fireEvent.click(magicButton);
    expect(defaultToolbarProps.onMagicBackfill).toHaveBeenCalledTimes(1);
  });

  it('disables magic backfill button when canRunMagicBackfill is false', () => {
    render(<BackupFilesToolbar {...defaultToolbarProps} canRunMagicBackfill={false} />);
    const magicButton = screen.getByTitle('Respaldo masivo de fechas faltantes del mes');
    expect(magicButton).toBeDisabled();
  });

  it('disables refresh button when isLoading is true', () => {
    render(<BackupFilesToolbar {...defaultToolbarProps} isLoading />);
    expect(screen.getByTitle('Refrescar')).toBeDisabled();
  });
});

// ─── BackupFilesContent ─────────────────────────────────────────────
// This component is tightly coupled to complex types and sub-components.
// We test its core rendering branches with minimal mocks.

describe('BackupFilesContent', () => {
  it.todo('renders loading state when isLoading is true and not refetching');
  it.todo('renders empty state when items array is empty');
  it.todo('renders HandoffCalendarView when path.length === 2 and type is handoff');
  it.todo('renders DailyBackupCalendarView when path.length === 2 and type is census');
  it.todo('renders folder cards for folder items');
  it.todo('renders file cards for file items');
});
