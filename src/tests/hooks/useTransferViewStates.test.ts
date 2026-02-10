import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransferViewStates } from '@/hooks/useTransferViewStates';
import { DailyRecord } from '@/types';
import { TransferRequest } from '@/types/transfers';

// Mock dependencies
vi.mock('@/constants/hospitalConfigs', () => ({
    getHospitalConfigById: vi.fn().mockReturnValue({ id: 'hospital-salvador', name: 'Hospital Salvador' }),
}));

vi.mock('@/services/transfers/documentGeneratorService', () => ({
    generateTransferDocuments: vi.fn().mockResolvedValue([]),
}));

import { TransferFormData } from '@/types/transfers';

describe('useTransferViewStates', () => {
    let mockRecord: DailyRecord;
    let mockUpdateTransfer: (id: string, data: Partial<TransferRequest>) => Promise<void>;
    let mockCreateTransfer: (data: TransferFormData) => Promise<void>;
    let mockAdvanceStatus: (transfer: TransferRequest) => Promise<void>;
    let mockMarkAsTransferred: (transfer: TransferRequest, method: string) => Promise<void>;
    let mockCancelTransfer: (transfer: TransferRequest, reason: string) => Promise<void>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRecord = { date: '2024-12-28', beds: {} } as DailyRecord;
        mockUpdateTransfer = vi.fn().mockResolvedValue(undefined);
        mockCreateTransfer = vi.fn().mockResolvedValue(undefined);
        mockAdvanceStatus = vi.fn().mockResolvedValue(undefined);
        mockMarkAsTransferred = vi.fn().mockResolvedValue(undefined);
        mockCancelTransfer = vi.fn().mockResolvedValue(undefined);
    });

    it('should return modals and handlers', () => {
        const { result } = renderHook(() =>
            useTransferViewStates(
                mockRecord,
                mockUpdateTransfer,
                mockCreateTransfer,
                mockAdvanceStatus,
                mockMarkAsTransferred,
                mockCancelTransfer
            )
        );

        expect(result.current.modals).toBeDefined();
        expect(result.current.handlers).toBeDefined();
        expect(result.current.selectedTransfer).toBeNull();
    });

    it('should handle new request', () => {
        const { result } = renderHook(() =>
            useTransferViewStates(
                mockRecord,
                mockUpdateTransfer,
                mockCreateTransfer,
                mockAdvanceStatus,
                mockMarkAsTransferred,
                mockCancelTransfer
            )
        );

        act(() => {
            result.current.handlers.handleNewRequest();
        });

        expect(result.current.modals.form).toBe(true);
    });

    it('should handle edit transfer', () => {
        const mockTransfer = { id: 'test-1', bedId: 'R1' } as TransferRequest;

        const { result } = renderHook(() =>
            useTransferViewStates(
                mockRecord,
                mockUpdateTransfer,
                mockCreateTransfer,
                mockAdvanceStatus,
                mockMarkAsTransferred,
                mockCancelTransfer
            )
        );

        act(() => {
            result.current.handlers.handleEditTransfer(mockTransfer);
        });

        expect(result.current.modals.form).toBe(true);
        expect(result.current.selectedTransfer).toBe(mockTransfer);
    });

    it('should close form modal', () => {
        const { result } = renderHook(() =>
            useTransferViewStates(
                mockRecord,
                mockUpdateTransfer,
                mockCreateTransfer,
                mockAdvanceStatus,
                mockMarkAsTransferred,
                mockCancelTransfer
            )
        );

        act(() => {
            result.current.handlers.handleNewRequest();
        });

        act(() => {
            result.current.handlers.handleCloseFormModal();
        });

        expect(result.current.modals.form).toBe(false);
    });

    it('should handle status change', () => {
        const mockTransfer = { id: 'test-1', bedId: 'R1' } as TransferRequest;

        const { result } = renderHook(() =>
            useTransferViewStates(
                mockRecord,
                mockUpdateTransfer,
                mockCreateTransfer,
                mockAdvanceStatus,
                mockMarkAsTransferred,
                mockCancelTransfer
            )
        );

        act(() => {
            result.current.handlers.handleStatusChange(mockTransfer);
        });

        expect(result.current.modals.status).toBe(true);
    });

    it('should handle cancel', () => {
        const mockTransfer = { id: 'test-1', bedId: 'R1' } as TransferRequest;

        const { result } = renderHook(() =>
            useTransferViewStates(
                mockRecord,
                mockUpdateTransfer,
                mockCreateTransfer,
                mockAdvanceStatus,
                mockMarkAsTransferred,
                mockCancelTransfer
            )
        );

        act(() => {
            result.current.handlers.handleCancel(mockTransfer);
        });

        expect(result.current.modals.cancel).toBe(true);
    });

    it('should handle generate docs', () => {
        const mockTransfer = { id: 'test-1', bedId: 'R1' } as TransferRequest;

        const { result } = renderHook(() =>
            useTransferViewStates(
                mockRecord,
                mockUpdateTransfer,
                mockCreateTransfer,
                mockAdvanceStatus,
                mockMarkAsTransferred,
                mockCancelTransfer
            )
        );

        act(() => {
            result.current.handlers.handleGenerateDocs(mockTransfer);
        });

        expect(result.current.modals.questionnaire).toBe(true);
    });
});
