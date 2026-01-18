
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ConsolidationManager } from '@/views/admin/components/audit/ConsolidationManager';
import * as consolidationService from '@/services/admin/auditConsolidationService';

// Mock del servicio
vi.mock('@/services/admin/auditConsolidationService', () => ({
    previewConsolidation: vi.fn(),
    executeConsolidation: vi.fn()
}));

describe('ConsolidationManager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Mock global confirm
        global.confirm = vi.fn(() => true);
    });

    it('renders initial state correctly', () => {
        render(<ConsolidationManager />);

        expect(screen.getByText('Mantenimiento de Auditoría')).toBeInTheDocument();
        expect(screen.getByText('Previsualizar')).toBeEnabled();
        expect(screen.getByRole('button', { name: /optimizar/i })).toBeDisabled();
        expect(screen.getByText(/Analiza la base de datos/)).toBeInTheDocument();
    });

    it('handles preview flow correctly', async () => {
        const mockPreviewData = {
            totalLogs: 100,
            duplicateGroups: [
                {
                    action: 'TEST_ACTION',
                    entityId: 'E1',
                    count: 3,
                    firstTimestamp: '2025-01-01T10:00:00Z',
                    lastTimestamp: '2025-01-01T10:00:05Z',
                    logs: []
                }
            ],
            estimatedDeletions: 2
        };

        vi.mocked(consolidationService.previewConsolidation).mockResolvedValue(mockPreviewData);

        render(<ConsolidationManager />);

        // Click Preview
        fireEvent.click(screen.getByText('Previsualizar'));

        // Should show loading state (implicit via async wait)

        await waitFor(() => {
            expect(screen.getByText('100')).toBeInTheDocument(); // Total Logs
            expect(screen.getByText('1')).toBeInTheDocument(); // Duplicate Groups count
            expect(screen.getByText('2')).toBeInTheDocument(); // Estimated Deletions
        });

        // Verify table rendering
        expect(screen.getByText('TEST_ACTION')).toBeInTheDocument();
        expect(screen.getByText('E1')).toBeInTheDocument();

        // Optimize button should now be enabled
        expect(screen.getByRole('button', { name: /optimizar/i })).toBeEnabled();
    });

    it('handles execution flow correctly', async () => {
        // Setup preview state first
        const mockPreviewData = {
            totalLogs: 10,
            duplicateGroups: [],
            estimatedDeletions: 0
        };
        vi.mocked(consolidationService.previewConsolidation).mockResolvedValue(mockPreviewData);

        const mockResultData = {
            logsConsolidated: 5,
            logsDeleted: 3,
            errors: []
        };
        // Mock execute with progress callback simulation
        vi.mocked(consolidationService.executeConsolidation).mockImplementation(async (_, __, onProgress) => {
            if (onProgress) onProgress('Procesando...');
            return {
                ...mockResultData,
                success: true,
                totalLogs: 10,
                groupsFound: 5
            };
        });

        render(<ConsolidationManager />);

        // Go to preview state
        fireEvent.click(screen.getByText('Previsualizar'));
        await waitFor(() => screen.getByText('10'));

        // Click Optimize
        fireEvent.click(screen.getByRole('button', { name: /optimizar/i }));

        // Check confirm was called
        expect(global.confirm).toHaveBeenCalled();

        // Check loading/progress
        await waitFor(() => {
            expect(screen.getByText('Procesando...')).toBeInTheDocument();
        });

        // Check success result
        await waitFor(() => {
            expect(screen.getByText('¡Consolidación Exitosa!')).toBeInTheDocument();
            expect(screen.getByText('5')).toBeInTheDocument(); // Consolidated
            expect(screen.getByText('3')).toBeInTheDocument(); // Deleted
        });
    });

    it('handles errors during execution', async () => {
        const mockPreviewData = {
            totalLogs: 10,
            duplicateGroups: [],
            estimatedDeletions: 0
        };
        vi.mocked(consolidationService.previewConsolidation).mockResolvedValue(mockPreviewData);

        const errorResult = {
            logsConsolidated: 0,
            logsDeleted: 0,
            errors: ['Error crítico en Firestore'],
            success: false,
            totalLogs: 10,
            groupsFound: 0
        };
        vi.mocked(consolidationService.executeConsolidation).mockResolvedValue(errorResult);

        render(<ConsolidationManager />);

        // To preview
        fireEvent.click(screen.getByText('Previsualizar'));
        await waitFor(() => screen.getByText('10'));

        // Execute
        fireEvent.click(screen.getByRole('button', { name: /optimizar/i }));

        await waitFor(() => {
            expect(screen.getByText(/Hubo algunos errores/)).toBeInTheDocument();
            expect(screen.getByText('Error crítico en Firestore')).toBeInTheDocument();
        });
    });
});
