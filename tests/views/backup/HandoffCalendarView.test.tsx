/**
 * Tests for HandoffCalendarView component
 * Tests file grouping, sorting, and rendering
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { render, screen, fireEvent } from '@testing-library/react';
import { HandoffCalendarView } from '@/views/backup/components/HandoffCalendarView';
import { StoredPdfFile } from '@/services/backup/pdfStorageService';

// Mock date utilities to be deterministic
vi.mock('@/utils/dateUtils', () => ({
    formatDateDDMMYYYY: (isoDate?: string) => {
        if (!isoDate) return '-';
        const parts = isoDate.split('-');
        if (parts.length !== 3) return isoDate;
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
    },
    getTodayISO: () => '2026-01-02',
    generateDateRange: (_year: number, _month: number, _limitToToday: boolean) => {
        // Return a fixed small range to make testing easier
        return ['2026-01-01', '2026-01-02'];
    }
}));

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
                    year={2026}
                    monthName="Enero"
                    onDownload={mockOnDownload}
                    onView={mockOnView}
                    onDelete={mockOnDelete}
                    canDelete={true}
                    formatSize={mockFormatSize}
                />
            );

            // Should have header row + 2 data rows (based on our mock range) = 3 total
            const rows = screen.getAllByRole('row');
            expect(rows).toHaveLength(3);
        });

        it('shows dash for missing shifts', () => {
            const files: StoredPdfFile[] = [
                createMockFile('2026-01-01', 'day'), // Only day shift
            ];

            render(
                <HandoffCalendarView
                    files={files}
                    year={2026}
                    monthName="Enero"
                    onDownload={mockOnDownload}
                    onView={mockOnView}
                    onDelete={mockOnDelete}
                    canDelete={true}
                    formatSize={mockFormatSize}
                />
            );

            // Should show "—" (dash) for missing night shift on 2026-01-01 
            // and for both shifts on 2026-01-02 (empty in our mock range)
            expect(screen.getAllByText('—').length).toBeGreaterThan(0);
        });
    });

    describe('Chronological sorting', () => {
        it('sorts files oldest first (chronological order)', () => {
            const files: StoredPdfFile[] = [
                createMockFile('2026-01-02', 'day'),
                createMockFile('2026-01-01', 'day'),
            ];

            render(
                <HandoffCalendarView
                    files={files}
                    year={2026}
                    monthName="Enero"
                    onDownload={mockOnDownload}
                    onView={mockOnView}
                    onDelete={mockOnDelete}
                    canDelete={true}
                    formatSize={mockFormatSize}
                />
            );

            const rows = screen.getAllByRole('row').slice(1); // Skip header
            const dates = rows.map(row => row.querySelector('td')?.textContent);

            // Our mock range returns ['2026-01-01', '2026-01-02']
            expect(dates).toEqual(['01-01-2026', '02-01-2026']);
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
                    year={2026}
                    monthName="Enero"
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
    });

    describe('Display formatting', () => {
        it('displays file size correctly', () => {
            const files: StoredPdfFile[] = [
                createMockFile('2026-01-01', 'day', 150000),
            ];

            render(
                <HandoffCalendarView
                    files={files}
                    year={2026}
                    monthName="Enero"
                    onDownload={mockOnDownload}
                    onView={mockOnView}
                    onDelete={mockOnDelete}
                    canDelete={true}
                    formatSize={mockFormatSize}
                />
            );

            expect(screen.getByText('146 KB')).toBeInTheDocument();
        });
    });

    describe('Edge cases', () => {
        it('returns null when monthName is invalid', () => {
            const { container } = render(
                <HandoffCalendarView
                    files={[]}
                    year={2026}
                    monthName="MesInvalido"
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
                    year={2026}
                    monthName="Enero"
                    onDownload={mockOnDownload}
                    onView={mockOnView}
                    onDelete={mockOnDelete}
                    canDelete={true}
                    formatSize={mockFormatSize}
                />
            );

            expect(screen.getByText('01-01-2026')).toBeInTheDocument();
        });
    });
});
