import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SharedCensusView } from '@/features/census/components/SharedCensusView';
import type { CensusAccessUser } from '@/types/censusAccess';

const useSharedCensusFilesMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useSharedCensusFiles', () => ({
    useSharedCensusFiles: useSharedCensusFilesMock
}));

vi.mock('@/components/shared/ExcelViewerModal', () => ({
    ExcelViewerModal: ({
        fileName,
        canDownload,
        onClose,
        onDownload
    }: {
        fileName: string;
        canDownload: boolean;
        onClose: () => void;
        onDownload: () => void;
    }) => (
        <div data-testid="excel-viewer-modal">
            <span>{fileName}</span>
            <button onClick={onClose}>Cerrar visor</button>
            {canDownload && <button onClick={onDownload}>Descargar visor</button>}
        </div>
    )
}));

const buildAccessUser = (role: CensusAccessUser['role']): CensusAccessUser => ({
    id: 'user-1',
    email: 'guest@example.com',
    displayName: 'Usuario Invitado',
    role,
    createdAt: new Date(),
    createdBy: 'admin',
    expiresAt: new Date(),
    isActive: true
});

describe('SharedCensusView', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-02-13T10:00:00.000Z'));
        useSharedCensusFilesMock.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders denied state when access has an error', () => {
        useSharedCensusFilesMock.mockReturnValue({
            filteredFiles: [],
            isLoading: false,
            loadError: null,
            searchTerm: '',
            setSearchTerm: vi.fn(),
            selectedFile: null,
            setSelectedFile: vi.fn(),
            handlers: {
                handleViewFile: vi.fn(),
                handleDownload: vi.fn()
            }
        });

        render(<SharedCensusView accessUser={null} error="Invitación expirada" />);

        expect(screen.getByText('Acceso Denegado')).toBeInTheDocument();
        expect(screen.getByText('Invitación expirada')).toBeInTheDocument();
    });

    it('renders loading state while files are being fetched', () => {
        useSharedCensusFilesMock.mockReturnValue({
            filteredFiles: [],
            isLoading: true,
            loadError: null,
            searchTerm: '',
            setSearchTerm: vi.fn(),
            selectedFile: null,
            setSelectedFile: vi.fn(),
            handlers: {
                handleViewFile: vi.fn(),
                handleDownload: vi.fn()
            }
        });

        render(<SharedCensusView accessUser={null} error={null} />);

        expect(screen.getByText('Cargando censo compartido...')).toBeInTheDocument();
    });

    it('renders ready state and triggers view action', () => {
        const file = {
            name: '10-02-2026 - Censo Diario.xlsx',
            fullPath: '/censo/2026/02/file.xlsx',
            downloadUrl: 'https://example.com/file.xlsx',
            date: '2026-02-10',
            createdAt: '2026-02-10T08:00:00.000Z',
            size: 1024
        };
        const handleViewFile = vi.fn();

        useSharedCensusFilesMock.mockReturnValue({
            filteredFiles: [file],
            isLoading: false,
            loadError: null,
            searchTerm: '',
            setSearchTerm: vi.fn(),
            selectedFile: null,
            setSelectedFile: vi.fn(),
            handlers: {
                handleViewFile,
                handleDownload: vi.fn()
            }
        });

        render(<SharedCensusView accessUser={buildAccessUser('viewer')} error={null} />);

        expect(screen.getByText('Archivos de Censo Diario')).toBeInTheDocument();
        expect(screen.getByText('Febrero 2026')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Visualizar Censo'));
        expect(handleViewFile).toHaveBeenCalledWith(file);
        expect(screen.queryByTitle('Descargar')).not.toBeInTheDocument();
    });

    it('shows download actions for downloader role and selected file modal', () => {
        const file = {
            name: '10-02-2026 - Censo Diario.xlsx',
            fullPath: '/censo/2026/02/file.xlsx',
            downloadUrl: 'https://example.com/file.xlsx',
            date: '2026-02-10',
            createdAt: '2026-02-10T08:00:00.000Z',
            size: 1024
        };
        const handleDownload = vi.fn();

        useSharedCensusFilesMock.mockReturnValue({
            filteredFiles: [file],
            isLoading: false,
            loadError: null,
            searchTerm: '',
            setSearchTerm: vi.fn(),
            selectedFile: file,
            setSelectedFile: vi.fn(),
            handlers: {
                handleViewFile: vi.fn(),
                handleDownload
            }
        });

        render(<SharedCensusView accessUser={buildAccessUser('downloader')} error={null} />);

        fireEvent.click(screen.getByTitle('Descargar'));
        expect(handleDownload).toHaveBeenCalledWith(file);
        expect(screen.getByTestId('excel-viewer-modal')).toBeInTheDocument();
    });
});
