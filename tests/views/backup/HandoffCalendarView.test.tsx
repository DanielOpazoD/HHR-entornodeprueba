/**
 * Tests for HandoffCalendarView component
 * Tests file grouping, sorting, and rendering
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { render, screen, fireEvent } from '@testing-library/react';
import { HandoffCalendarView } from '@/views/backup/components/HandoffCalendarView';
import { StoredPdfFile } from '@/services/backup/pdfStorageService';


// Mock lucide-react icons
vi.mock('lucide-react', () => ({
    Download: () => <span data-testid="download-icon">Download</span>,
    Trash2: () => <span data-testid="trash-icon">Trash</span>,
    Sun: () => <span data-testid="sun-icon">Sun</span>,
    Moon: () => <span data-testid="moon-icon">Moon</span>,
    Eye: () => <span data-testid="eye-icon">Eye</span>,
    Calendar: () => <span data-testid="calendar-icon">Calendar</span>
}));

const mockFormatSize = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

const createMockFile = (date: string, shiftType: 'day' | 'night', size: number = 150000): StoredPdfFile => ({
    name: `${date.split('-').reverse().join('-')} - Turno ${shiftType === 'day' ? 'Largo' : 'Noche'}.pdf`,
    fullPath: `entregas-enfermeria/2026/01/${date.split('-').reverse().join('-')} - Turno ${shiftType === 'day' ? 'Largo' : 'Noche'}.pdf`,
    downloadUrl: `https://example.com/${date}-${shiftType}.pdf`,
    date,
    shiftType,
    createdAt: `${date}T10:00:00Z`,
    size
});

describe('HandoffCalendarView', () => {
    const mockOnDownload = vi.fn();
    const mockOnView = vi.fn();
    const mockOnDelete = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('File grouping', () => {
        it('groups files by date correctly', () => {
            const files: StoredPdfFile[] = [
                createMockFile('2026-01-01', 'day'),
                createMockFile('2026-01-01', 'night'),
                createMockFile('2026-01-02', 'day'),
            ];

            render(
                <HandoffCalendarView
                    files={files}
                    onDownload={mockOnDownload}
                    onView={mockOnView}
                    onDelete={mockOnDelete}
                    canDelete={true}
                    formatSize={mockFormatSize}
                />
            );

            // Should have 2 rows (2 unique dates)
            const rows = screen.getAllByRole('row');
            // 1 header row + 2 data rows = 3 total
            expect(rows).toHaveLength(3);
        });

        it('shows dash for missing shifts', () => {
            const files: StoredPdfFile[] = [
                createMockFile('2026-01-01', 'day'), // Only day shift
            ];

            render(
                <HandoffCalendarView
                    files={files}
                    onDownload={mockOnDownload}
                    onView={mockOnView}
                    onDelete={mockOnDelete}
                    canDelete={true}
                    formatSize={mockFormatSize}
                />
            );

            // Should show "—" for missing night shift
            expect(screen.getByText('—')).toBeInTheDocument();
        });
    });

    describe('Chronological sorting', () => {
        it('sorts files oldest first (chronological order)', () => {
            const files: StoredPdfFile[] = [
                createMockFile('2026-01-03', 'day'),
                createMockFile('2026-01-01', 'day'),
                createMockFile('2026-01-02', 'day'),
            ];

            render(
                <HandoffCalendarView
                    files={files}
                    onDownload={mockOnDownload}
                    onView={mockOnView}
                    onDelete={mockOnDelete}
                    canDelete={true}
                    formatSize={mockFormatSize}
                />
            );

            // Get all date cells
            const rows = screen.getAllByRole('row').slice(1); // Skip header
            const dates = rows.map(row => row.querySelector('td')?.textContent);

            // Should be in chronological order
            expect(dates).toEqual(['01-01-2026', '02-01-2026', '03-01-2026']);
        });
    });

    describe('User interactions', () => {
        it('calls onDownload when download button is clicked', () => {
            const files: StoredPdfFile[] = [
                createMockFile('2026-01-01', 'day'),
            ];

            render(
                <HandoffCalendarView
                    files={files}
                    onDownload={mockOnDownload}
                    onView={mockOnView}
                    onDelete={mockOnDelete}
                    canDelete={true}
                    formatSize={mockFormatSize}
                />
            );

            const downloadButtons = screen.getAllByTitle('Descargar');
            fireEvent.click(downloadButtons[0]);

            expect(mockOnDownload).toHaveBeenCalledTimes(1);
            expect(mockOnDownload).toHaveBeenCalledWith(files[0]);
        });

        it('calls onDelete when delete button is clicked', () => {
            const files: StoredPdfFile[] = [
                createMockFile('2026-01-01', 'day'),
            ];

            render(
                <HandoffCalendarView
                    files={files}
                    onDownload={mockOnDownload}
                    onView={mockOnView}
                    onDelete={mockOnDelete}
                    canDelete={true}
                    formatSize={mockFormatSize}
                />
            );

            const deleteButtons = screen.getAllByTitle('Eliminar');
            fireEvent.click(deleteButtons[0]);

            expect(mockOnDelete).toHaveBeenCalledTimes(1);
            expect(mockOnDelete).toHaveBeenCalledWith(files[0]);
        });

        it('hides delete button when canDelete is false', () => {
            const files: StoredPdfFile[] = [
                createMockFile('2026-01-01', 'day'),
            ];

            render(
                <HandoffCalendarView
                    files={files}
                    onDownload={mockOnDownload}
                    onView={mockOnView}
                    onDelete={mockOnDelete}
                    canDelete={false}
                    formatSize={mockFormatSize}
                />
            );

            expect(screen.queryByTitle('Eliminar')).not.toBeInTheDocument();
        });
    });

    describe('Display formatting', () => {
        it('displays file size correctly', () => {
            const files: StoredPdfFile[] = [
                createMockFile('2026-01-01', 'day', 150000),
            ];

            render(
                <HandoffCalendarView
                    files={files}
                    onDownload={mockOnDownload}
                    onView={mockOnView}
                    onDelete={mockOnDelete}
                    canDelete={true}
                    formatSize={mockFormatSize}
                />
            );

            expect(screen.getByText('146 KB')).toBeInTheDocument();
        });

        it('displays date in DD-MM-YYYY format', () => {
            const files: StoredPdfFile[] = [
                createMockFile('2026-01-03', 'day'),
            ];

            render(
                <HandoffCalendarView
                    files={files}
                    onDownload={mockOnDownload}
                    onView={mockOnView}
                    onDelete={mockOnDelete}
                    canDelete={true}
                    formatSize={mockFormatSize}
                />
            );

            expect(screen.getByText('03-01-2026')).toBeInTheDocument();
        });
    });

    describe('Edge cases', () => {
        it('returns null when files array is empty', () => {
            const { container } = render(
                <HandoffCalendarView
                    files={[]}
                    onDownload={mockOnDownload}
                    onView={mockOnView}
                    onDelete={mockOnDelete}
                    canDelete={true}
                    formatSize={mockFormatSize}
                />
            );

            expect(container.firstChild).toBeNull();
        });

        it('handles single file correctly', () => {
            const files: StoredPdfFile[] = [
                createMockFile('2026-01-01', 'night'),
            ];

            render(
                <HandoffCalendarView
                    files={files}
                    onDownload={mockOnDownload}
                    onView={mockOnView}
                    onDelete={mockOnDelete}
                    canDelete={true}
                    formatSize={mockFormatSize}
                />
            );

            // Should have header + 1 data row
            const rows = screen.getAllByRole('row');
            expect(rows).toHaveLength(2);
        });
    });
});
