import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useShiftPanel } from '@/hooks/useShiftPanel';
import * as whatsappService from '@/services/integrations/whatsapp/whatsappService';

// Mock whatsappService
vi.mock('@/services/integrations/whatsapp/whatsappService', () => ({
    subscribeToCurrentShift: vi.fn(),
    saveManualShift: vi.fn(),
    fetchShiftsFromGroup: vi.fn(),
}));

import { WeeklyShift } from '@/types/whatsapp';

describe('useShiftPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default mock for subscribeToCurrentShift
        vi.mocked(whatsappService.subscribeToCurrentShift).mockImplementation((callback: (shift: WeeklyShift | null) => void) => {
            callback(null);
            return () => { };
        });
    });

    it('should initialize with loading state', () => {
        const { result } = renderHook(() => useShiftPanel());

        expect(result.current.shift).toBeNull();
        expect(result.current.showOriginal).toBe(false);
        expect(result.current.showImportModal).toBe(false);
    });

    it('should subscribe to shift updates', () => {
        const mockShift: WeeklyShift = {
            startDate: '2024-12-01',
            endDate: '2024-12-07',
            source: 'whatsapp',
            parsedAt: '2024-12-01T12:00:00Z',
            staff: []
        };
        vi.mocked(whatsappService.subscribeToCurrentShift).mockImplementation((callback: (shift: WeeklyShift | null) => void) => {
            callback(mockShift);
            return () => { };
        });

        const { result } = renderHook(() => useShiftPanel());

        expect(result.current.shift).toEqual(mockShift);
        expect(result.current.loading).toBe(false);
    });

    it('should toggle view mode', () => {
        const { result } = renderHook(() => useShiftPanel());

        act(() => {
            result.current.toggleViewMode('original');
        });
        expect(result.current.showOriginal).toBe(true);

        act(() => {
            result.current.toggleViewMode('parsed');
        });
        expect(result.current.showOriginal).toBe(false);
    });

    it('should set import modal state', () => {
        const { result } = renderHook(() => useShiftPanel());

        act(() => {
            result.current.setShowImportModal(true);
        });
        expect(result.current.showImportModal).toBe(true);
    });

    it('should handle import with empty message', async () => {
        const { result } = renderHook(() => useShiftPanel());

        act(() => {
            result.current.setImportMessage('');
        });

        await act(async () => {
            await result.current.handleImport();
        });

        expect(result.current.importError).toBe('Por favor, pega el mensaje de turno');
    });

    it('should handle successful import', async () => {
        vi.mocked(whatsappService.saveManualShift).mockResolvedValue({ success: true });

        const { result } = renderHook(() => useShiftPanel());

        act(() => {
            result.current.setImportMessage('Test message');
            result.current.setShowImportModal(true);
        });

        await act(async () => {
            await result.current.handleImport();
        });

        expect(result.current.showImportModal).toBe(false);
        expect(result.current.importMessage).toBe('');
    });

    it('should handle fetch from group', async () => {
        vi.mocked(whatsappService.fetchShiftsFromGroup).mockResolvedValue({ success: true, message: 'Fetched' });

        const { result } = renderHook(() => useShiftPanel());

        await act(async () => {
            await result.current.handleFetchFromGroup();
        });

        expect(result.current.fetchResult).toEqual({ success: true, message: 'Fetched' });
        expect(result.current.fetching).toBe(false);
    });
});
